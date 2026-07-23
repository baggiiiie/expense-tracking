import { type FlueContext, type FlueHarness } from '@flue/runtime';
import * as v from 'valibot';
import agent from '../agents/issue-resolver.ts';

/**
 * resolve-issue workflow
 *
 * Orchestrates the pipeline in code and uses the agent for the parts that need
 * judgment: triage, code editing, and live browser verification:
 *
 *   fetch issue            (code: gh)
 *   -> triage              (AGENT: classify + draft any comment)
 *   -> close if not fixable (code: gh)
 *   -> implement fix        (AGENT: edits files in the sandbox)
 *   -> verify               (code: go test for server, pnpm build for web)
 *   -> commit + push        (code: git/gh, direct to the default branch)
 *   -> record web demo      (agent-browser, visible web changes only)
 *   -> comment + close      (code: gh; visible web fixes require a recording)
 *
 * A valid, in-scope fix is pushed straight to the default branch (no PR) and
 * the issue is closed as completed — but only after verification passes. Each
 * touched area is verified with its own build; iOS changes need a macOS
 * simulator so they are the one area left for a human. A fix that fails code
 * verification is not pushed; a pushed web fix that fails live browser
 * verification leaves the issue open.
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

// Base URL the recording server is reached at (see recordWebDemo).
const REC_BASE = 'http://127.0.0.1:8080';
// Record in portrait at the CSS viewport size of a representative modern
// iPhone. Keeping this in CSS pixels exercises the app's mobile layout without
// generating an unnecessarily large video.
const REC_VIEWPORT = { width: 390, height: 844 } as const;
// Demo credentials for the throwaway recording server. The web app gates the
// whole UI behind /login (an unauthenticated API call 401s and redirects), so
// the workflow launches `expense serve` with these LOGIN_USERNAME/PASSWORD env
// values and injects a deterministic sign-in scene before the model's scenes.
const REC_USER = 'demo';
const REC_PASS = 'demo-password';

// The agent first classifies whether the change is visible and chooses a safe
// same-origin route. Once the workflow has opened that route, the agent uses a
// live agent-browser snapshot to inspect and demonstrate the change.
const RecordingIntent = v.object({
  applicable: v.boolean(),
  reason: v.string(),
  path: v.string(),
});

const RecordingOutcome = v.object({
  demonstrated: v.boolean(),
  note: v.string(),
});

type DemoResult = {
  applicable: boolean;
  recorded: boolean;
  screenshotUrl?: string;
  gifUrl?: string;
  mp4Url?: string;
  note: string;
};

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
  demo: v.optional(
    v.object({
      applicable: v.boolean(),
      recorded: v.boolean(),
      screenshotUrl: v.optional(v.string()),
      gifUrl: v.optional(v.string()),
      mp4Url: v.optional(v.string()),
      note: v.string(),
    }),
  ),
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

  // Do not use GitHub closing keywords (for example, `Fix #123`) here. The
  // change is pushed before visual verification, so auto-closing would bypass
  // the explicit close below when recording fails.
  await harness.fs.writeFile(
    '/tmp/resolve-issue-commit.txt',
    buildCommitMessage(n, fix.summary),
  );
  await sh(`git add -A`);
  const commit = await sh(`git commit -F /tmp/resolve-issue-commit.txt`);
  if (commit.exitCode !== 0) throw new Error(`git commit failed: ${commit.stderr.trim()}`);

  const sha = (await sh(`git rev-parse --short HEAD`)).stdout.trim();

  const push = await sh(`git push origin HEAD:${defaultBranch}`);
  if (push.exitCode !== 0) throw new Error(`git push failed: ${push.stderr.trim()}`);

  // 7. Record visible web changes. The fix has already landed, but an issue
  // with a visible change stays open if the recording fails so the missing
  // visual verification cannot be mistaken for success.
  let demo: DemoResult | undefined;
  let mediaSection = '';
  if (changed.some(isWeb)) {
    demo = await recordWebDemo({ harness, sh, session, n, title: issue.title }).catch(
      (err: unknown): DemoResult => ({
        applicable: true,
        recorded: false,
        note: `recording error: ${String(err)}`,
      }),
    );
    if (demo.applicable && !demo.recorded) {
      await comment(
        `Fixed in ${sha} on \`${defaultBranch}\`, but screen recording failed: ` +
          `\`${demo.note}\`. Leaving open for visual verification.`,
      );
      return {
        issue: n,
        triage: triageOut,
        fix: { attempted: true, applied: true, commitSha: sha, summary: fix.summary },
        verification,
        demo: {
          applicable: demo.applicable,
          recorded: demo.recorded,
          screenshotUrl: demo.screenshotUrl,
          gifUrl: demo.gifUrl,
          mp4Url: demo.mp4Url,
          note: demo.note,
        },
        closed: false,
      };
    }
    if (demo.recorded) {
      mediaSection = `\n\n**Verified in-browser:**`;
      if (demo.screenshotUrl) mediaSection += `\n\n![screenshot](${demo.screenshotUrl})`;
      if (demo.gifUrl) mediaSection += `\n\n![demo](${demo.gifUrl})`;
      if (demo.mp4Url) mediaSection += `\n\n[Full-resolution recording](${demo.mp4Url})`;
    }
  }

  await comment(`Fixed in ${sha} on \`${defaultBranch}\`. Closing.${mediaSection}`);
  await sh(`gh issue close ${n} --reason completed`);

  return {
    issue: n,
    triage: triageOut,
    fix: { attempted: true, applied: true, commitSha: sha, summary: fix.summary },
    verification,
    demo: demo && {
      applicable: demo.applicable,
      recorded: demo.recorded,
      screenshotUrl: demo.screenshotUrl,
      gifUrl: demo.gifUrl,
      mp4Url: demo.mp4Url,
      note: demo.note,
    },
    closed: true,
  };
}

/**
 * Record a production-like web demo with agent-browser. The workflow owns the
 * server, login, viewport, recording, screenshot, and cleanup. The agent only
 * decides whether the change is visible, then inspects and operates the live
 * page using accessibility snapshots and runtime refs.
 */
type ShellResult = { exitCode: number; stdout: string; stderr: string };
type RecordDeps = {
  harness: FlueHarness;
  sh: (command: string) => Promise<ShellResult>;
  session: Awaited<ReturnType<FlueHarness['session']>>;
  n: number;
  title: string;
};

async function recordWebDemo(deps: RecordDeps): Promise<DemoResult> {
  const { harness, sh, session, n, title } = deps;

  const { data: intent } = await session.prompt(
    `Decide whether the fix you just made for issue #${n} ("${title}") has a ` +
      `visible web UI result. If it does, return the same-origin route where it ` +
      `can be demonstrated (for example, "/" or "/settings"). Do not run any ` +
      `commands yet. Set applicable=false for changes with no visible web UI.`,
    { result: RecordingIntent },
  );
  if (!intent.applicable) {
    return { applicable: false, recorded: false, note: `not applicable: ${intent.reason}` };
  }

  const build = await sh(`cd server && go build -o /tmp/expense-rec ./cmd/expense`);
  if (build.exitCode !== 0) {
    return {
      applicable: true,
      recorded: false,
      note: `server build failed: ${commandError(build)}`,
    };
  }

  // Seed recent expenses and require success: the agent must inspect a known,
  // deterministic UI state rather than trying to explain an empty page.
  await sh(
    `rm -f /tmp/rec.db* /tmp/rec-prefs.json /tmp/rec-secret.json ` +
      `/tmp/demo.webm /tmp/issue-${n}.png /tmp/issue-${n}.gif /tmp/issue-${n}.mp4`,
  );
  const now = new Date();
  const earlierDate = new Date(now);
  earlierDate.setUTCDate(now.getUTCDate() - 1);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const seed = [
    { amount: 4.5, category: 'Food & Dining', merchant: 'Blue Bottle', date: iso(now) },
    { amount: 12.99, category: 'Entertainment', merchant: 'Netflix', date: iso(now) },
    { amount: 62.1, category: 'Groceries', merchant: 'Whole Foods', date: iso(earlierDate) },
    { amount: 18.0, category: 'Transport', merchant: 'Uber', date: iso(earlierDate) },
  ];
  await harness.fs.writeFile('/tmp/seed.json', JSON.stringify(seed));
  const seeded = await sh(
    `/tmp/expense-rec add --db /tmp/rec.db --config /tmp/rec-prefs.json --json @/tmp/seed.json`,
  );
  if (seeded.exitCode !== 0) {
    return { applicable: true, recorded: false, note: `demo seed failed: ${commandError(seeded)}` };
  }

  const browserSession = `resolve-issue-${n}`;
  const browser = `npx --no-install agent-browser --session ${shellQuote(browserSession)}`;
  const runBrowser = async (args: string): Promise<ShellResult> => {
    const result = await sh(`${browser} ${args}`);
    if (result.exitCode !== 0) {
      const safeArgs = args.replaceAll(REC_PASS, '[redacted]');
      throw new Error(`agent-browser ${safeArgs} failed: ${commandError(result)}`);
    }
    return result;
  };

  let serverStarted = false;
  let recordingStarted = false;
  try {
    await sh(`${browser} close >/dev/null 2>&1 || true`);
    const launched = await sh(
      `nohup env LOGIN_USERNAME=${REC_USER} LOGIN_PASSWORD=${REC_PASS} ` +
        `/tmp/expense-rec serve --port 8080 --db /tmp/rec.db ` +
        `--config /tmp/rec-prefs.json --secret-file /tmp/rec-secret.json ` +
        `>/tmp/expense-rec.log 2>&1 & echo $! >/tmp/expense-rec.pid`,
    );
    if (launched.exitCode !== 0) throw new Error(`server launch failed: ${commandError(launched)}`);
    serverStarted = true;

    const ready = await sh(
      `for attempt in $(seq 1 50); do ` +
        `curl -fsS ${REC_BASE}/login >/dev/null && exit 0; sleep 0.2; ` +
        `done; tail -50 /tmp/expense-rec.log >&2; exit 1`,
    );
    if (ready.exitCode !== 0) throw new Error(`recording server did not become ready`);

    await runBrowser(`open about:blank`);
    await runBrowser(`set viewport ${REC_VIEWPORT.width} ${REC_VIEWPORT.height}`);
    await runBrowser(`open ${shellQuote(`${REC_BASE}/login`)}`);
    await runBrowser(`wait ${shellQuote('input[autocomplete="username"]')}`);
    await runBrowser(`fill ${shellQuote('input[autocomplete="username"]')} ${shellQuote(REC_USER)}`);
    await runBrowser(`fill ${shellQuote('input[type="password"]')} ${shellQuote(REC_PASS)}`);
    await runBrowser(`click ${shellQuote('.btn-login')}`);
    await runBrowser(`wait --url ${shellQuote('**/')}`);
    await runBrowser(`wait ${shellQuote('.shell')}`);

    const targetUrl = demoUrl(intent.path);
    if (targetUrl !== `${REC_BASE}/`) {
      await runBrowser(`open ${shellQuote(targetUrl)}`);
      await runBrowser(`wait --load domcontentloaded`);
    }

    await runBrowser(`record start ${shellQuote('/tmp/demo.webm')}`);
    recordingStarted = true;

    const { data: outcome } = await session.prompt(
      `Use the live browser to demonstrate the visible fix for issue #${n}. ` +
        `The authenticated app is open at ${targetUrl} in agent-browser session ` +
        `"${browserSession}" with recording already active. Run agent-browser ` +
        `commands through your shell using exactly this prefix: ` +
        `\`npx --no-install agent-browser --session ${browserSession}\`. Start by ` +
        `running \`snapshot -c\` so you inspect the rendered page before choosing ` +
        `targets. Prefer snapshot refs and semantic find commands over guessed CSS, ` +
        `and re-snapshot after page changes. Exercise only the changed behavior, ` +
        `keep the final visible state on screen, and run \`wait 1000\` so a human ` +
        `can see it. Do not start or stop recording, take screenshots, close the ` +
        `browser, run git/gh, or edit files. Return demonstrated=true only after ` +
        `you observed the expected result in the live page.`,
      { result: RecordingOutcome },
    );

    await runBrowser(`screenshot ${shellQuote(`/tmp/issue-${n}.png`)}`);
    await runBrowser(`record stop`);
    recordingStarted = false;

    if (!outcome.demonstrated) {
      return {
        applicable: true,
        recorded: false,
        note: `agent could not demonstrate the change: ${outcome.note}`,
      };
    }

    const artifacts = await sh(
      `test -s /tmp/demo.webm && test -s /tmp/issue-${n}.png`,
    );
    if (artifacts.exitCode !== 0) {
      return { applicable: true, recorded: false, note: 'agent-browser produced no media' };
    }

    const gif = await sh(
      `ffmpeg -y -i /tmp/demo.webm -vf ` +
        `"fps=10,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" ` +
        `/tmp/issue-${n}.gif`,
    );
    const mp4 = await sh(
      `ffmpeg -y -i /tmp/demo.webm -movflags +faststart -pix_fmt yuv420p ` +
        `/tmp/issue-${n}.mp4`,
    );
    const haveGif = gif.exitCode === 0;
    const haveMp4 = mp4.exitCode === 0;
    if (!haveGif && !haveMp4) {
      return { applicable: true, recorded: false, note: 'ffmpeg produced no converted video' };
    }

    const slug = (await sh(`gh repo view --json nameWithOwner --jq .nameWithOwner`)).stdout.trim();
    const pub = await publishMedia(sh, n, true, haveGif, haveMp4);
    if (pub.exitCode !== 0) {
      return {
        applicable: true,
        recorded: false,
        note: `publish failed: ${commandError(pub)}`,
      };
    }

    const rawBase = `https://raw.githubusercontent.com/${slug}/bot-media`;
    return {
      applicable: true,
      recorded: true,
      screenshotUrl: `${rawBase}/issue-${n}.png`,
      gifUrl: haveGif ? `${rawBase}/issue-${n}.gif` : undefined,
      mp4Url: haveMp4 ? `${rawBase}/issue-${n}.mp4` : undefined,
      note: outcome.note || 'recorded with agent-browser',
    };
  } catch (error) {
    return { applicable: true, recorded: false, note: String(error) };
  } finally {
    if (recordingStarted) await sh(`${browser} record stop >/dev/null 2>&1 || true`);
    await sh(`${browser} close >/dev/null 2>&1 || true`);
    if (serverStarted) {
      await sh(`kill $(cat /tmp/expense-rec.pid) >/dev/null 2>&1 || true`);
    }
  }
}

/** Build a descriptive commit subject without triggering GitHub auto-close. */
export function buildCommitMessage(issueNumber: number, summary: string): string {
  return `Address issue #${issueNumber}: ${summary}\n`;
}

/** Resolve an agent-provided path to the local recording origin. */
export function demoUrl(path: string): string {
  try {
    const url = new URL(path || '/', REC_BASE);
    return url.origin === new URL(REC_BASE).origin ? url.href : `${REC_BASE}/`;
  } catch {
    return `${REC_BASE}/`;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function commandError(result: ShellResult): string {
  return (result.stderr || result.stdout).slice(-500).trim() || `exit ${result.exitCode}`;
}

/**
 * Publish per-issue media files to the orphan `bot-media` branch using a git
 * worktree so the main working tree is untouched. Uses the already-configured
 * bot git identity. Non-destructive to other issues' files.
 */
async function publishMedia(
  sh: (command: string) => Promise<ShellResult>,
  n: number,
  haveScreenshot: boolean,
  haveGif: boolean,
  haveMp4: boolean,
): Promise<ShellResult> {
  const copy = [
    haveScreenshot ? `cp /tmp/issue-${n}.png /tmp/botmedia/` : '',
    haveGif ? `cp /tmp/issue-${n}.gif /tmp/botmedia/` : '',
    haveMp4 ? `cp /tmp/issue-${n}.mp4 /tmp/botmedia/` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return sh(
    `set -e\n` +
      `git worktree remove --force /tmp/botmedia 2>/dev/null || true\n` +
      `rm -rf /tmp/botmedia\n` +
      `if git ls-remote --exit-code --heads origin bot-media >/dev/null 2>&1; then\n` +
      `  git fetch origin bot-media\n` +
      `  git worktree add -B bot-media /tmp/botmedia origin/bot-media\n` +
      `else\n` +
      `  git worktree add --detach /tmp/botmedia\n` +
      `  git -C /tmp/botmedia checkout --orphan bot-media\n` +
      `  git -C /tmp/botmedia rm -rf . >/dev/null 2>&1 || true\n` +
      `fi\n` +
      `${copy}\n` +
      `cd /tmp/botmedia\n` +
      `git add -A\n` +
      `if git diff --cached --quiet; then\n` +
      `  echo "bot-media: no change for issue #${n}"\n` +
      `else\n` +
      `  git commit -m "media: issue #${n}" >/dev/null\n` +
      `  git push origin bot-media\n` +
      `fi\n` +
      `cd -\n` +
      `git worktree remove --force /tmp/botmedia || true`,
  );
}

/** Files changed in the working tree, from `git status --porcelain` (deterministic). */
async function changedFiles(harness: FlueHarness): Promise<string[]> {
  const status = await harness.shell(`git status --porcelain`);
  return status.stdout
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}
