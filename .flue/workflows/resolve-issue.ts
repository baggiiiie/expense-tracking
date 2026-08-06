import { type FlueHarness } from '@flue/runtime';
import * as v from 'valibot';

import type { Github } from './github.ts';
import type { DemoResult, WebDemo } from './web-demo.ts';

/**
 * resolve-issue workflow
 *
 * Orchestrates the pipeline in code and uses the agent only for judgment
 * (triage, code editing, and live browser demonstration):
 *
 *   fetch issue        (code: Github)
 *   -> triage          (AGENT: classify; post the reason + close/leave-open for
 *                        anything the workflow won't fix)
 *   -> implement fix    (AGENT: edits files, then runs the build/tests until
 *                        they pass; reports whether verification passed)
 *   -> commit + push    (code: git/Github, direct to the default branch)
 *   -> web demo         (WebDemo: best-effort recording of visible web changes;
 *                        never blocks the fix)
 *   -> comment + close  (code: Github; comment links the demo, or notes why it
 *                        couldn't be recorded)
 *
 * A valid, in-scope fix is pushed straight to the default branch (no PR) and the
 * issue closed as completed, but only after verification passes. External
 * integrations are injected via {@link ResolveDeps}; omit `demo`, or inject a
 * read-only Github, to run without those side effects.
 *
 * Payload: { "issueNumber": 42 } resolves one issue.
 */
export const PayloadSchema = v.object({
  issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

export type Payload = v.InferOutput<typeof PayloadSchema>;


const TriageCategory = v.picklist(['bug', 'feature', 'invalid', 'duplicate', 'stale', 'unclear']);
// The triage prompt's output, also reported in the workflow Result. For
// categories the workflow won't fix, `reason` is posted to the issue author.
const Triage = v.object({
  valid: v.boolean(),
  category: TriageCategory,
  reason: v.string(),
});

const Fix = v.object({
  applied: v.boolean(),
  verified: v.boolean(),
  summary: v.string(),
});

export const Result = v.object({
  issue: v.number(),
  triage: Triage,
  fix: v.object({
    attempted: v.boolean(),
    applied: v.boolean(),
    commitSha: v.optional(v.string()),
    summary: v.optional(v.string()),
  }),
  verification: v.object({
    ran: v.boolean(),
    passed: v.boolean(),
    details: v.string(),
  }),
  demo: v.optional(
    v.object({
      applicable: v.boolean(),
      recorded: v.boolean(),
      media: v.object({
        screenshotUrl: v.optional(v.string()),
        gifUrl: v.optional(v.string()),
        mp4Url: v.optional(v.string()),
      }),
      note: v.string(),
    }),
  ),
  closed: v.boolean(),
});

export type ResultType = v.InferOutput<typeof Result>;

export type ShellResult = { exitCode: number; stdout: string; stderr: string };

/** External integrations the resolver depends on (dependency-injection seam). */
export type ResolveDeps = {
  github: Github;
  /** Optional: omit to skip the visible-web-change demo step entirely. */
  demo?: WebDemo;
};

export async function resolveIssue(
  harness: FlueHarness,
  payload: Payload,
  deps: ResolveDeps,
  signal?: AbortSignal,
): Promise<ResultType> {
  const { github } = deps;
  const n = payload.issueNumber;

  const sh = (command: string) => harness.sandbox.exec(command, { signal });
  const checked = async (command: string, description: string): Promise<ShellResult> => {
    const result = await sh(command);
    if (result.exitCode !== 0) throw new Error(`${description} failed: ${commandError(result)}`);
    return result;
  };
  await setupEnv(harness, signal);

  // 1. Fetch the issue (deterministic).
  const issue = await github.getIssue(n);
  const issueJson = JSON.stringify(issue);

  const noFix = { attempted: false, applied: false } as const;
  const noVerify = { ran: false, passed: false, details: '' } as const;

  const triageResult = (triage: ResultType['triage'], closed: boolean): ResultType => ({
    issue: n,
    triage,
    fix: noFix,
    verification: noVerify,
    closed,
  });

  if (issue.state?.toUpperCase() === 'CLOSED') {
    return triageResult({ valid: true, category: 'stale', reason: 'issue is already closed' }, true);
  }

  // 2. Triage (AGENT — judgment only, over the issue JSON we already fetched).
  const { data: triage } = await harness.prompt(
    `Triage GitHub issue #${n} for this repository. Classify it into exactly one ` +
      `category (bug, feature, invalid, duplicate, stale, unclear) and give a concise ` +
      `reason. For invalid/duplicate/stale/unclear the reason is posted as a comment to ` +
      `the issue author, so keep it short and polite. Do not edit files or run any commands.` +
      `\n\nISSUE JSON:\n${issueJson}`,
    { result: Triage, signal },
  );
  // 3. Not a fixable bug/feature: post the reason. Close the clearly-terminal
  // categories (invalid/duplicate/stale); leave unclear or unvalidated open.
  if (!triage.valid || (triage.category !== 'bug' && triage.category !== 'feature')) {
    await github.comment(n, triage.reason);
    const close = triage.valid && ['invalid', 'duplicate', 'stale'].includes(triage.category);
    if (close) await github.close(n, 'not planned');
    return triageResult(triage, close);
  }

  // 4. Implement the fix (AGENT — edits files only; the workflow owns git/gh).

  const { data: fix } = await harness.prompt(
    `Implement the smallest correct fix for issue #${n}: "${issue.title}". Edit only ` +
      `the files the fix requires; do not refactor unrelated code. Then verify your change ` +
      `by running \`npm run verify\` from the repo root and iterate until it passes. Use ` +
      `your file-editing and shell tools, but do NOT run git or gh, and do not commit, push, ` +
      `or close anything; the workflow handles that. Report whether you applied a fix, ` +
      `whether your verification passed, and a one-line summary.`,
    { result: Fix, signal },
  );

  const leaveOpen = async (message: string, verification: ResultType['verification']): Promise<ResultType> => {
    await github.comment(n, message);
    return {
      issue: n,
      triage,
      fix: { attempted: true, applied: false, summary: fix.summary },
      verification,
      closed: false,
    };
  };

  if (!fix.applied || (await changedFiles(harness, signal)).length === 0) {
    return leaveOpen(`Could not implement a safe automated fix. Leaving this open for a human.`, noVerify);
  }

  // 5. Trust the agent's self-reported verification for the push/close decision.
  const verification = {
    ran: true,
    passed: fix.verified,
    details: fix.verified
      ? 'agent verified the fix (build/tests passed)'
      : 'agent could not get the fix to pass verification',
  };
  if (!fix.verified) {
    return leaveOpen(
      `A fix was attempted but the agent could not get it to pass verification, so nothing was pushed. Leaving open.`,
      verification,
    );
  }

  // 6. Commit the verified fix (pushed in step 8, once any demo media is ready).
  const changed = await changedFiles(harness, signal); // captured before commit, for the demo
  const defaultBranch = await github.getDefaultBranch();
  await harness.sandbox.writeFile('/tmp/resolve-issue-commit.txt', buildCommitMessage(n, fix.summary));
  await checked(`git add -A`, 'git add');
  await checked(`git commit -F /tmp/resolve-issue-commit.txt`, 'git commit');
  const sha = (await checked(`git rev-parse --short HEAD`, 'git rev-parse')).stdout.trim();
  if (!sha) throw new Error('git rev-parse returned an empty commit SHA');

  // 7. Record a best-effort demo of visible web changes. It never blocks the
  // fix; a recording failure is just noted in the closing comment.
  const demo: DemoResult = deps.demo
    ? await deps.demo
        .demonstrate({ issueNumber: n, title: issue.title, changedFiles: changed })
        .catch((err: unknown): DemoResult => {
          if (isAbortError(err) || signal?.aborted) throw err;
          return { applicable: true, recorded: false, refs: [], media: {}, note: `recording error: ${String(err)}` };
        })
    : { applicable: false, recorded: false, refs: [], media: {}, note: 'no demo configured' };

  // 8. Push the fix and any demo media in one atomic push, then comment + close.
  await github.push(defaultBranch, demo.refs);
  await github.comment(n, `Fixed in ${sha} on \`${defaultBranch}\`. Closing.${demoSection(demo)}`);
  await github.close(n, 'completed');

  const resultDemo = demo.applicable
    ? { applicable: demo.applicable, recorded: demo.recorded, media: demo.media, note: demo.note }
    : undefined;
  return {
    issue: n,
    triage,
    fix: { attempted: true, applied: true, commitSha: sha, summary: fix.summary },
    verification,
    ...(resultDemo ? { demo: resultDemo } : {}),
    closed: true,
  };
}

/** Markdown appended to the closing comment: the recorded demo, or why it failed. */
function demoSection(demo: DemoResult): string {
  if (demo.recorded) {
    let section = `\n\n**Verified in-browser:**`;
    if (demo.media.screenshotUrl) section += `\n\n![screenshot](${demo.media.screenshotUrl})`;
    if (demo.media.gifUrl) section += `\n\n![demo](${demo.media.gifUrl})`;
    if (demo.media.mp4Url) section += `\n\n[Full-resolution recording](${demo.media.mp4Url})`;
    return section;
  }
  if (demo.applicable) return `\n\n_Automated demo couldn't be recorded: ${demo.note}_`;
  return '';
}

/** Build a descriptive commit subject without triggering GitHub auto-close. */
export function buildCommitMessage(issueNumber: number, summary: string): string {
  return `Address issue #${issueNumber}: ${summary}\n`;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function commandError(result: ShellResult): string {
  return (result.stderr || result.stdout).slice(-500).trim() || `exit ${result.exitCode}`;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Parse `git status --porcelain=v1 -z`, preserving unusual path names. */
export function parsePorcelainV1Z(output: string): string[] {
  if (!output) return [];
  const records = output.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') {
      throw new Error(`invalid git porcelain record: ${JSON.stringify(record)}`);
    }
    const status = record.slice(0, 2);
    paths.push(record.slice(3));
    if (status.includes('R') || status.includes('C')) {
      const source = records[++index];
      if (source === undefined || source === '') throw new Error('incomplete git rename record');
      paths.push(source);
    }
  }
  return [...new Set(paths)];
}

async function gitStatus(harness: FlueHarness, signal?: AbortSignal): Promise<ShellResult> {
  const status = await harness.sandbox.exec(`git status --porcelain=v1 -z --untracked-files=all`, { signal });
  if (status.exitCode !== 0) throw new Error(`git status failed: ${commandError(status)}`);
  return status;
}

export async function assertCleanWorkspace(harness: FlueHarness, signal?: AbortSignal): Promise<void> {
  const status = await gitStatus(harness, signal);
  const changed = parsePorcelainV1Z(status.stdout);
  if (changed.length > 0) {
    throw new Error(`issue resolver requires a clean disposable checkout; refusing to touch: ${changed.join(', ')}`);
  }
}

/**
 * Prepare the disposable checkout: require a clean tree and set the bot's git
 * identity.
 */
export async function setupEnv(harness: FlueHarness, signal?: AbortSignal): Promise<void> {
  await assertCleanWorkspace(harness, signal);
  const config = await harness.sandbox.exec(
    `git config user.name "issue-resolver[bot]" && ` +
      `git config user.email "issue-resolver@users.noreply.github.com"`,
    { signal },
  );
  if (config.exitCode !== 0) throw new Error(`git identity configuration failed: ${commandError(config)}`);
}

/** Files changed in the working tree, including both sides of renames. */
async function changedFiles(harness: FlueHarness, signal?: AbortSignal): Promise<string[]> {
  return parsePorcelainV1Z((await gitStatus(harness, signal)).stdout);
}
