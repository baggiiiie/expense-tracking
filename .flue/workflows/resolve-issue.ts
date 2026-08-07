import { type FlueHarness } from '@flue/runtime';
import * as v from 'valibot';

import { commandError, type ShellResult } from './shell.ts';
import type { Github } from './github.ts';
import type { WebDemo } from './web-demo.ts';

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
  const shortHead = async (): Promise<string> =>
    (await checked(`git rev-parse --short HEAD`, 'git rev-parse')).stdout.trim();
  await setupEnv(harness, signal);

  // 1. Fetch the issue (deterministic; includes any feedback images).
  const issue = await github.getIssue(n);

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

  // 2. Triage (AGENT — judgment only, over the issue we already fetched).
  const { data: triage } = await harness.prompt(
    `Triage GitHub issue #${n} for this repository. Classify it into exactly one ` +
      `category (bug, feature, invalid, duplicate, stale, unclear) and give a concise ` +
      `reason. Do not edit files or run any commands yet.` +
      `\n\n<issue_content>:\n${issue.content}\n</issue_content>`,
    { result: Triage, images: issue.images, signal },
  );
  // 3. Not a fixable bug/feature: post the reason. Close the clearly-terminal
  // categories (invalid/duplicate/stale); leave unclear or unvalidated open.
  if (!triage.valid || (triage.category !== 'bug' && triage.category !== 'feature')) {
    await github.comment(n, triage.reason);
    const close = triage.valid && ['invalid', 'duplicate', 'stale'].includes(triage.category);
    if (close) await github.close(n, 'not planned');
    return triageResult(triage, close);
  }

  // 4. Implement, verify, and commit the fix (AGENT). Local git only — the
  // workflow still owns push, comment, and close.
  const baseSha = await shortHead();
  const { data: fix } = await harness.prompt(
    `Implement the smallest correct fix for issue #${n}. Edit only the ` +
      `files the fix requires; do not refactor unrelated code. Verify by running ` +
      `\`npm run verify\` from the repo root and iterate until it passes. Then commit your ` +
      `change with \`git add -A && git commit\`, using a message of the form ` +
      `"Address issue #${n}: <summary>" — do NOT use GitHub auto-close keywords like ` +
      `"fixes" or "closes"; the workflow closes the issue itself. Do NOT run \`git push\` or ` +
      `any \`gh\` command, and do not close the issue; the workflow pushes and closes. ` +
      `Report whether you applied a fix, whether your verification passed, and a one-line summary.`,
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

  // The agent's edits should now live in a new commit; HEAD moving off baseSha is
  // the deterministic signal that a fix actually landed.
  const sha = await shortHead();
  if (!fix.applied || sha === baseSha) {
    return leaveOpen(`Could not implement and commit a safe automated fix. Leaving this open for a human.`, noVerify);
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
      `A fix was committed but did not pass verification, so nothing was pushed. Leaving open.`,
      verification,
    );
  }

  // 6. Look up the branch to push the agent's commit to.
  const defaultBranch = await github.getDefaultBranch();

  // 7. Record a best-effort demo of visible web changes. It never blocks the fix;
  // demonstrate() reports its own outcome and closing-comment markdown.
  const demo = deps.demo ? await deps.demo.demonstrate({ issueNumber: n }) : undefined;

  // 8. Push the fix and any demo media in one atomic push, then comment + close.
  await github.push(defaultBranch, demo?.refs ?? []);
  await github.comment(n, `Fixed in ${sha} on \`${defaultBranch}\`. Closing.${demo?.comment ?? ''}`);
  await github.close(n, 'completed');

  const resultDemo = demo?.applicable
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

/** Trimmed `git status --porcelain` output; an empty string means a clean tree. */
/**
 * Prepare the disposable checkout: require a clean tree (so the agent's edits
 * can't be confused with pre-existing ones) and set the bot's git identity.
 */
export async function setupEnv(harness: FlueHarness, signal?: AbortSignal): Promise<void> {
  const status = await harness.sandbox.exec(`git status --porcelain --untracked-files=all`, { signal });
  if (status.exitCode !== 0) throw new Error(`git status failed: ${commandError(status)}`);
  const dirty = status.stdout.trim();
  if (dirty) {
    throw new Error(`issue resolver requires a clean disposable checkout; refusing to touch:\n${dirty}`);
  }
  const config = await harness.sandbox.exec(
    `git config user.name "issue-resolver[bot]" && ` +
      `git config user.email "issue-resolver@users.noreply.github.com"`,
    { signal },
  );
  if (config.exitCode !== 0) throw new Error(`git identity configuration failed: ${commandError(config)}`);
}

