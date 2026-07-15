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
 *   -> commit + push        (code: git/gh, direct to the default branch)
 *   -> record web demo      (shot-scraper video, visible web changes only)
 *   -> comment + close      (code: gh; visible web fixes require a recording)
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

// A single interaction inside a scene. This mirrors shot-scraper's `do:` step
// shapes but in a flat, easy-to-validate form; buildStoryboard converts it to
// shot-scraper's single-key map form.
const Step = v.variant('action', [
  v.object({ action: v.literal('pause'), seconds: v.number() }),
  v.object({ action: v.literal('click'), selector: v.string() }),
  v.object({ action: v.literal('wait_for'), selector: v.string() }),
  v.object({ action: v.literal('wait_for_url'), url: v.string() }),
  v.object({ action: v.literal('fill'), selector: v.string(), text: v.string() }),
]);

const Scene = v.object({
  name: v.string(),
  // Path to navigate to at the start of the scene (relative, e.g. "/settings").
  open: v.optional(v.string()),
  waitFor: v.optional(v.string()),
  do: v.array(Step),
});

// The model's proposed screen-recording routine. The workflow owns the
// sensitive storyboard keys (server argv, url, output, viewport); the model
// only describes the interactions.
const Recording = v.object({
  applicable: v.boolean(),
  reason: v.string(),
  // Starting path, e.g. "/". The workflow signs in and navigates here first.
  path: v.string(),
  scenes: v.array(Scene),
});
type RecordingType = v.InferOutput<typeof Recording>;

type DemoResult = {
  applicable: boolean;
  recorded: boolean;
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

  await harness.fs.writeFile('/tmp/resolve-issue-commit.txt', `Fix #${n}: ${fix.summary}\n`);
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
          gifUrl: demo.gifUrl,
          mp4Url: demo.mp4Url,
          note: demo.note,
        },
        closed: false,
      };
    }
    if (demo.recorded) {
      mediaSection = `\n\n**Verified in-browser:**`;
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
      gifUrl: demo.gifUrl,
      mp4Url: demo.mp4Url,
      note: demo.note,
    },
    closed: true,
  };
}

/**
 * recordWebDemo — screen recording of the web app demonstrating the
 * fix, published to the orphan `bot-media` branch and returned as inline media.
 *
 * Production-like: it builds the `expense` binary (which embeds the built web
 * dist and serves both the SPA and the /api on :8080, exactly like a real
 * deployment) and lets shot-scraper launch it against a throwaway SQLite DB.
 *
 * The model supplies only the interaction routine (validated structured
 * steps); the workflow owns the sensitive storyboard keys. Any failure returns
 * a non-recorded result so the caller can leave visible web fixes open for
 * verification.
 */
type ShellResult = { exitCode: number; stdout: string; stderr: string };
type RecordDeps = {
  harness: FlueHarness;
  sh: (command: string) => Promise<ShellResult>;
  session: Awaited<ReturnType<FlueHarness['session']>>;
  n: number;
  title: string;
};

async function recordWebDemo(
  deps: RecordDeps,
): Promise<DemoResult> {
  const { harness, sh, session, n, title } = deps;

  // 1. Ask the agent (which just wrote the fix, so it has full context) for a
  //    short storyboard demonstrating the change.
  const { data: rec } = await session.prompt(
    `Produce a short screen-recording routine that demonstrates the fix you just ` +
      `made for issue #${n} ("${title}") in the web app. The workflow already ` +
      `signs in and navigates to your \`path\` for you, so assume the app is ` +
      `authenticated — do NOT include any login steps. Set \`path\` to the route ` +
      `your demo starts on and set each scene's \`waitFor\` to a stable, unique ` +
      `selector for the feature that scene demonstrates. The recording viewport ` +
      `is an iPhone-sized ${REC_VIEWPORT.width}x${REC_VIEWPORT.height} portrait display. ` +
      `The app has a few demo expenses seeded across the default categories, so ` +
      `lists are non-empty. Use CSS selectors that exist in the components you ` +
      `edited; any \`wait_for\` selector must match exactly one element ` +
      `(Playwright strict mode fails on multiple matches). Keep it under ~25 ` +
      `seconds and focused on the changed behaviour: exercise the feature and ` +
      `pause briefly so it is visible. Set applicable=false (empty scenes) if the ` +
      `change has no visible UI (e.g. build config, types, tests). Do not run any ` +
      `commands.`,
    { result: Recording },
  );
  if (!rec.applicable) {
    return { applicable: false, recorded: false, note: `not applicable: ${rec.reason}` };
  }
  if (rec.scenes.length === 0) {
    return {
      applicable: true,
      recorded: false,
      note: 'recording storyboard contained no scenes',
    };
  }

  // 2. Build the production-like server binary (embeds the web dist).
  const build = await sh(`cd server && go build -o /tmp/expense-rec ./cmd/expense`);
  if (build.exitCode !== 0) {
    return {
      applicable: true,
      recorded: false,
      note: `server build failed: ${build.stderr.slice(-300).trim()}`,
    };
  }

  // 3. Seed a small, recent demo dataset so lists aren't empty. The server
  //    uses embedded SQLite (no external DB service); it auto-creates and
  //    migrates the throwaway file and seeds default categories, but has no
  //    expenses. Dates are within the current month so they fall inside the
  //    app's default "this month" view. Best-effort: a seed failure just means
  //    we record against whatever state exists.
  await sh(`rm -f /tmp/rec.db* /tmp/rec-prefs.json /tmp/rec-secret.json /tmp/demo.webm`);
  const now = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  const iso = (day: number) => `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(day)}`;
  const today = iso(now.getUTCDate());
  const earlier = iso(Math.max(1, now.getUTCDate() - 1));
  const seed = [
    { amount: 4.5, category: 'Food & Dining', merchant: 'Blue Bottle', date: today },
    { amount: 12.99, category: 'Entertainment', merchant: 'Netflix', date: today },
    { amount: 62.1, category: 'Groceries', merchant: 'Whole Foods', date: earlier },
    { amount: 18.0, category: 'Transport', merchant: 'Uber', date: earlier },
  ];
  await harness.fs.writeFile('/tmp/seed.json', JSON.stringify(seed));
  await sh(
    `/tmp/expense-rec add --db /tmp/rec.db --config /tmp/rec-prefs.json --json @/tmp/seed.json`,
  );

  // 4. Assemble the storyboard (workflow owns server/url/output/viewport).
  const storyboard = buildStoryboard(rec);
  await harness.fs.writeFile('/tmp/storyboard.yml', JSON.stringify(storyboard, null, 2));

  // 5. Record. shot-scraper launches the server against the pre-seeded DB,
  //    inheriting the demo login credentials from this command's env. Note we
  //    do NOT wipe /tmp/rec.db* here — that would drop the seed.
  const shot = await sh(
    `LOGIN_USERNAME=${REC_USER} LOGIN_PASSWORD=${REC_PASS} ` +
      `shot-scraper video /tmp/storyboard.yml`,
  );
  if (shot.exitCode !== 0) {
    return {
      applicable: true,
      recorded: false,
      note: `shot-scraper failed: ${shot.stderr.slice(-300).trim()}`,
    };
  }

  // 6. Convert to an inline GIF (renders in the comment) and a full-res MP4.
  const gif = await sh(
    `ffmpeg -y -i /tmp/demo.webm -vf ` +
      `"fps=12,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" ` +
      `/tmp/issue-${n}.gif`,
  );
  const mp4 = await sh(
    `ffmpeg -y -i /tmp/demo.webm -movflags +faststart -pix_fmt yuv420p /tmp/issue-${n}.mp4`,
  );
  const haveGif = gif.exitCode === 0;
  const haveMp4 = mp4.exitCode === 0;
  if (!haveGif && !haveMp4) {
    return { applicable: true, recorded: false, note: 'ffmpeg produced no output' };
  }

  // 7. Publish to the orphan bot-media branch (per-issue files, overwritten on
  //    re-runs; other issues' media is preserved).
  const slug = (await sh(`gh repo view --json nameWithOwner --jq .nameWithOwner`)).stdout.trim();
  const pub = await publishMedia(sh, n, haveGif, haveMp4);
  if (pub.exitCode !== 0) {
    return {
      applicable: true,
      recorded: false,
      note: `publish failed: ${pub.stderr.slice(-300).trim()}`,
    };
  }

  const rawBase = `https://raw.githubusercontent.com/${slug}/bot-media`;
  return {
    applicable: true,
    recorded: true,
    gifUrl: haveGif ? `${rawBase}/issue-${n}.gif` : undefined,
    mp4Url: haveMp4 ? `${rawBase}/issue-${n}.mp4` : undefined,
    note: 'recorded',
  };
}

/** Convert the validated Recording into a shot-scraper storyboard object. */
export function buildStoryboard(rec: RecordingType) {
  const toDo = (s: v.InferOutput<typeof Step>): Record<string, unknown> => {
    switch (s.action) {
      case 'pause':
        return { pause: s.seconds };
      case 'click':
        return { click: s.selector };
      case 'wait_for':
        return { wait_for: s.selector };
      case 'wait_for_url':
        return { wait_for_url: s.url };
      case 'fill':
        return { fill: { into: s.selector, text: s.text } };
    }
  };
  const modelScenes = rec.scenes.map((sc) => ({
    name: sc.name,
    ...(sc.open ? { open: `${REC_BASE}${sc.open}` } : {}),
    ...(sc.waitFor ? { wait_for: sc.waitFor } : {}),
    do: sc.do.map(toDo),
  }));

  // Deterministic sign-in scene. Wait for both the SPA navigation and the
  // authenticated home shell instead of coupling this to a particular nav UI.
  const loginScene = {
    name: 'Sign in',
    do: [
      { pause: 0.6 },
      { fill: { into: 'input[autocomplete="username"]', text: REC_USER } },
      { fill: { into: 'input[type="password"]', text: REC_PASS } },
      { pause: 0.4 },
      { click: '.btn-login' },
      { wait_for_url: '**/' },
      { wait_for: '.shell' },
      { pause: 0.6 },
    ],
  };

  // After login we land on '/'. If the model wants a different starting path,
  // navigate there (still deterministic) before its scenes run.
  const path = rec.path || '/';
  const openScene =
    path === '/'
      ? []
      : [
          {
            name: `Open ${path}`,
            open: `${REC_BASE}${path}`,
            do: [{ wait_for_url: `**${path}` }, { pause: 0.6 }],
          },
        ];

  return {
    output: '/tmp/demo.webm',
    // shot-scraper launches this and waits for the port before recording.
    server: ['/tmp/expense-rec', 'serve', '--port', '8080', '--db', '/tmp/rec.db', '--config', '/tmp/rec-prefs.json', '--secret-file', '/tmp/rec-secret.json'],
    url: `${REC_BASE}/login`,
    viewport: REC_VIEWPORT,
    cursor: true,
    wait_for: 'input[autocomplete="username"]',
    scenes: [loginScene, ...openScene, ...modelScenes],
  };
}

/**
 * Publish per-issue media files to the orphan `bot-media` branch using a git
 * worktree so the main working tree is untouched. Uses the already-configured
 * bot git identity. Non-destructive to other issues' files.
 */
async function publishMedia(
  sh: (command: string) => Promise<ShellResult>,
  n: number,
  haveGif: boolean,
  haveMp4: boolean,
): Promise<ShellResult> {
  const copy = [
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
