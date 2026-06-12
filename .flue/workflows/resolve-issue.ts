import { type FlueContext, type FlueHarness } from '@flue/runtime';
import * as v from 'valibot';
import agent from '../agents/issue-resolver.ts';

/**
 * resolve-issue workflow
 *
 * Orchestrates the pipeline in code and uses the agent only for the two parts
 * that actually need a model — judgment (triage) and code editing (fix):
 *
 *   fetch issue            (code: gh)
 *   -> triage              (AGENT: classify + draft any comment)
 *   -> close if not fixable (code: gh)
 *   -> implement fix        (AGENT: edits files in the sandbox)
 *   -> verify               (code: go test for server, pnpm build for web)
 *   -> commit + push + close (code: git/gh, direct to the default branch)
 *
 * A valid, in-scope fix is pushed straight to the default branch (no PR) and
 * the issue is closed as completed — but only after verification passes. Each
 * touched area is verified with its own build; iOS changes need a macOS
 * simulator so they are the one area left for a human. If a fix can't be made
 * or verified, nothing is pushed and the issue stays open.
 *
 * Payload: { "issueNumber": 42 } resolves one issue.
 * Add "dryRun": true to triage only (no edits, push, or close).
 */
type Payload = {
  issueNumber: number;
  dryRun?: boolean;
};

const PROTECTED_LABELS = ['keep-open', 'pinned', 'security', 'blocked', 'wip'];
const MAX_FIX_ATTEMPTS = 3; // initial fix + up to 2 verification-driven retries

const Triage = v.object({
  valid: v.boolean(),
  category: v.picklist(['bug', 'feature', 'invalid', 'duplicate', 'stale', 'unclear']),
  reason: v.string(),
  // A short comment to post for categories the workflow won't fix
  // (invalid/duplicate/stale/unclear). Empty for bug/feature.
  comment: v.string(),
});

const Fix = v.object({
  applied: v.boolean(),
  summary: v.string(),
});

const Result = v.object({
  issue: v.number(),
  triage: v.object({
    valid: v.boolean(),
    category: v.picklist(['bug', 'feature', 'invalid', 'duplicate', 'stale', 'unclear']),
    reason: v.string(),
  }),
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
  closed: v.boolean(),
});

type ResultType = v.InferOutput<typeof Result>;

export async function run({ init, payload }: FlueContext<Payload>): Promise<ResultType> {
  const n = payload.issueNumber;
  const dryRun = payload.dryRun ?? false;

  const harness = await init(agent);
  const session = await harness.session();

  const sh = (command: string) => harness.shell(command);
  const comment = async (body: string) => {
    if (dryRun) return;
    await harness.fs.writeFile('/tmp/resolve-issue-comment.md', body);
    await sh(`gh issue comment ${n} --body-file /tmp/resolve-issue-comment.md`);
  };

  // 1. Fetch the issue (deterministic).
  const view = await sh(
    `gh issue view ${n} --json number,title,body,labels,comments,state,updatedAt`,
  );
  if (view.exitCode !== 0) {
    throw new Error(`gh issue view ${n} failed: ${view.stderr.trim()}`);
  }
  const issue = JSON.parse(view.stdout) as {
    title: string;
    labels?: { name: string }[];
  };
  const labels = (issue.labels ?? []).map((l) => l.name);

  const noFix = { attempted: false, applied: false } as const;
  const noVerify = { ran: false, passed: false, details: '' } as const;

  // Protected labels: never touch (deterministic).
  if (labels.some((l) => PROTECTED_LABELS.includes(l))) {
    return {
      issue: n,
      triage: { valid: true, category: 'unclear', reason: `protected label present (${labels.join(', ')})` },
      fix: noFix,
      verification: noVerify,
      closed: false,
    };
  }

  // 2. Triage (AGENT — judgment only, over the issue JSON we already fetched).
  const { data: triage } = await session.prompt(
    `Triage GitHub issue #${n} for this repository. Classify it into exactly one ` +
      `category (bug, feature, invalid, duplicate, stale, unclear). For ` +
      `invalid/duplicate/stale/unclear, write a short, polite comment to post; ` +
      `for bug/feature leave comment empty. Do not edit files or run any commands.` +
      `\n\nISSUE JSON:\n${view.stdout}`,
    { result: Triage },
  );
  const triageOut = { valid: triage.valid, category: triage.category, reason: triage.reason };

  // 3. Not fixable -> comment (+ close for invalid/duplicate/stale) in code.
  if (triage.category === 'invalid' || triage.category === 'duplicate' || triage.category === 'stale') {
    await comment(triage.comment || `Closing as ${triage.category}: ${triage.reason}`);
    if (!dryRun) await sh(`gh issue close ${n} --reason "not planned"`);
    return { issue: n, triage: triageOut, fix: noFix, verification: noVerify, closed: !dryRun };
  }
  if (triage.category === 'unclear') {
    await comment(triage.comment || `Needs more detail before this can be resolved automatically.`);
    return { issue: n, triage: triageOut, fix: noFix, verification: noVerify, closed: false };
  }

  // Valid bug/feature.
  if (dryRun) {
    return {
      issue: n,
      triage: triageOut,
      fix: { attempted: false, applied: false, summary: 'dry run: would implement, verify, push, and close' },
      verification: { ran: false, passed: false, details: 'dry run' },
      closed: false,
    };
  }

  // 4. Implement the fix (AGENT — edits files only; the workflow owns git/gh).
  await sh(`git config user.name "issue-resolver[bot]"`);
  await sh(`git config user.email "issue-resolver@users.noreply.github.com"`);

  const { data: fix } = await session.prompt(
    `Implement the smallest correct fix for issue #${n}: "${issue.title}". Edit only ` +
      `the files the fix requires; do not refactor unrelated code. Use your file-editing ` +
      `tools — do NOT run git, gh, push, commit, or close anything; the workflow handles ` +
      `that. Report whether you applied a fix and a one-line summary.`,
    { result: Fix },
  );

  const changed = await changedFiles(harness);
  if (!fix.applied || changed.length === 0) {
    await sh(`git checkout -- . 2>/dev/null; git clean -fd 2>/dev/null`);
    await comment(`Could not implement a safe automated fix. Leaving this open for a human.`);
    return {
      issue: n,
      triage: triageOut,
      fix: { attempted: true, applied: false, summary: fix.summary },
      verification: noVerify,
      closed: false,
    };
  }

  // 5. Verify (deterministic). iOS changes need a macOS simulator and cannot be
  // verified on a Linux CI runner, so iOS is the only area left for a human.
  // Every other area is verified with its own build before pushing.
  const isIOS = (p: string) => p.startsWith('ios/');
  const isWeb = (p: string) => p.startsWith('server/web/');
  const isGoServer = (p: string) => p.startsWith('server/') && !isWeb(p);

  const iosLeftForHuman = async (): Promise<ResultType> => {
    await sh(`git checkout -- . 2>/dev/null; git clean -fd 2>/dev/null`);
    await comment(
      `A fix was drafted, but it changes iOS code, which needs a macOS ` +
        `simulator and can't be verified on the CI runner. Nothing was pushed; ` +
        `leaving open for a human.`,
    );
    return {
      issue: n,
      triage: triageOut,
      fix: { attempted: true, applied: false, summary: fix.summary },
      verification: { ran: false, passed: false, details: 'iOS changes require a macOS simulator (not available on CI)' },
      closed: false,
    };
  };

  if (changed.some(isIOS)) return iosLeftForHuman();

  // Build the verification commands for the areas this fix touches. Docs/config
  // and other non-code areas have nothing to build.
  const verifyCmds: string[] = [];
  if (changed.some(isGoServer)) verifyCmds.push('cd server && go build ./... && go test ./...');
  if (changed.some(isWeb)) verifyCmds.push('cd server/web && pnpm install --frozen-lockfile && pnpm build');

  const runVerify = async () => {
    for (const cmd of verifyCmds) {
      const r = await sh(cmd);
      if (r.exitCode !== 0) return { passed: false, cmd, stderr: r.stderr };
    }
    return { passed: true, cmd: verifyCmds.join(' && ') || 'none', stderr: '' };
  };

  let verify = await runVerify();
  for (let attempt = 1; !verify.passed && attempt < MAX_FIX_ATTEMPTS; attempt++) {
    await session.prompt(
      `Verification failed running \`${verify.cmd}\`. Fix the code so it passes. ` +
        `Edit files only; do not run git/gh.\n\nSTDERR (tail):\n${verify.stderr.slice(-4000)}`,
      { result: Fix },
    );
    verify = await runVerify();
  }

  const verifiedLabel = verifyCmds.length ? verifyCmds.join(' ; ') : 'no build required (docs/config only)';
  const verification = {
    ran: verifyCmds.length > 0,
    passed: verify.passed,
    details: verify.passed ? `verification passed: ${verifiedLabel}` : `failed: ${verify.stderr.slice(-500).trim()}`,
  };

  if (!verify.passed) {
    await sh(`git checkout -- . 2>/dev/null; git clean -fd 2>/dev/null`);
    await comment(`A fix was attempted but verification (\`${verify.cmd}\`) did not pass, so nothing was pushed. Leaving open.`);
    return {
      issue: n,
      triage: triageOut,
      fix: { attempted: true, applied: false, summary: fix.summary },
      verification,
      closed: false,
    };
  }

  // Final guard: a retry could have introduced iOS changes we cannot verify.
  if ((await changedFiles(harness)).some(isIOS)) return iosLeftForHuman();

  // 6. Commit, push to the default branch, comment, and close (deterministic).
  const branchRef = await sh(`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`);
  const defaultBranch = (branchRef.exitCode === 0 && branchRef.stdout.trim()) || 'master';

  await harness.fs.writeFile('/tmp/resolve-issue-commit.txt', `Fix #${n}: ${fix.summary}\n`);
  await sh(`git add -A`);
  const commit = await sh(`git commit -F /tmp/resolve-issue-commit.txt`);
  if (commit.exitCode !== 0) throw new Error(`git commit failed: ${commit.stderr.trim()}`);

  const sha = (await sh(`git rev-parse --short HEAD`)).stdout.trim();

  const push = await sh(`git push origin HEAD:${defaultBranch}`);
  if (push.exitCode !== 0) throw new Error(`git push failed: ${push.stderr.trim()}`);

  await comment(`Fixed in ${sha} on \`${defaultBranch}\`. Closing.`);
  await sh(`gh issue close ${n} --reason completed`);

  return {
    issue: n,
    triage: triageOut,
    fix: { attempted: true, applied: true, commitSha: sha, summary: fix.summary },
    verification,
    closed: true,
  };
}

/** Files changed in the working tree, from `git status --porcelain` (deterministic). */
async function changedFiles(harness: FlueHarness): Promise<string[]> {
  const status = await harness.shell(`git status --porcelain`);
  return status.stdout
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}
