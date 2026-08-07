import { type FlueHarness } from '@flue/runtime';
import * as v from 'valibot';

import { commandError, isAbortError, shellQuote, type ShellResult } from './shell.ts';
import { credentialedGit } from './github.ts';

// Base URL the recording server is reached at.
const REC_BASE = 'http://127.0.0.1:8080';
const REC_VIEWPORT = { width: 390, height: 844 } as const;
const REC_USER = 'demo';
const REC_PASS = 'demo-password';

// The agent navigates the live browser and judges, from the running app, whether
// the fix has a visible effect; if so it demonstrates it and reports success.
const RecordingOutcome = v.object({
  applicable: v.boolean(), // is there a visible UI change to show?
  demonstrated: v.boolean(), // did the agent observe the expected result?
  note: v.string(),
});

type DemoRequest = {
  issueNumber: number;
};

type DemoResult = {
  /** True when the change has a visible web UI result worth demonstrating. */
  applicable: boolean;
  /** True when visual proof was captured and media prepared for pushing. */
  recorded: boolean;
  /** Extra git refs the resolver must push atomically (e.g. ['bot-media']). */
  refs: string[];
  media: { screenshotUrl?: string; gifUrl?: string; mp4Url?: string };
  /** Markdown to append to the closing issue comment (empty when not applicable). */
  comment: string;
  note: string;
};

/**
 * Produces visual proof for visible web changes. This is a dependency-injection
 * seam: production wires {@link createBrowserDemo}; evals and unit tests omit it
 * entirely (the resolver then skips the demo step).
 *
 * The implementation is code-orchestrated with one embedded agent prompt — the
 * agent navigates the live browser and demonstrates the change — while code owns
 * the server, login, viewport, recording, transcoding, and media branch.
 */
export interface WebDemo {
  demonstrate(request: DemoRequest): Promise<DemoResult>;
}


/** Real browser-backed demo used by the production issue resolver. */
export function createBrowserDemo(harness: FlueHarness, signal?: AbortSignal): WebDemo {
  const token = process.env.GH_TOKEN;
  const sh = (command: string): Promise<ShellResult> =>
    harness.sandbox.exec(command, {
      signal,
      ...(token ? { env: { GH_TOKEN: token } } : {}),
    });
  const gitRemote = credentialedGit(token);

  return {
    demonstrate: (request) => recordWebDemo({ harness, sh, gitRemote, signal, request }),
  };
}

type RecordDeps = {
  harness: FlueHarness;
  sh: (command: string) => Promise<ShellResult>;
  gitRemote: string;
  signal?: AbortSignal;
  request: DemoRequest;
};

async function recordWebDemo(deps: RecordDeps): Promise<DemoResult> {
  const { harness, sh, gitRemote, signal, request } = deps;
  const { issueNumber: n } = request;

  const notApplicable = (reason: string): DemoResult => ({
    applicable: false,
    recorded: false,
    refs: [],
    media: {},
    comment: '',
    note: reason,
  });
  const failed = (note: string): DemoResult => ({
    applicable: true,
    recorded: false,
    refs: [],
    media: {},
    comment: `\n\n_Automated demo couldn't be recorded: ${note}_`,
    note,
  });

  const build = await sh(`cd server && go build -o /tmp/expense-rec ./cmd/expense`);
  if (build.exitCode !== 0) return failed(`server build failed: ${commandError(build)}`);

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
  await harness.sandbox.writeFile('/tmp/seed.json', JSON.stringify(seed));
  const seeded = await sh(`/tmp/expense-rec add --db /tmp/rec.db --config /tmp/rec-prefs.json --json @/tmp/seed.json`);
  if (seeded.exitCode !== 0) return failed(`demo seed failed: ${commandError(seeded)}`);

  const browserSession = `resolve-issue-${n}`;
  // agent-browser 0.32.4 does not reliably forward AGENT_BROWSER_ARGS to the
  // daemon on GitHub-hosted runners, so also pass configured launch arguments
  // explicitly on every command that can create or connect to the session.
  const browserArgs = process.env.AGENT_BROWSER_ARGS;
  const browser =
    `npx --no-install agent-browser --session ${shellQuote(browserSession)}` +
    (browserArgs ? ` --args ${shellQuote(browserArgs)}` : '');
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

    await runBrowser(`record start ${shellQuote('/tmp/demo.webm')}`);
    recordingStarted = true;

    const { data: outcome } = await harness.prompt(
      `Check and, if applicable, demonstrate the fix for issue #${n} in the ` +
        `live browser. The app is authenticated and open at ${REC_BASE} in agent-browser ` +
        `session "${browserSession}", and recording is already active. Run agent-browser ` +
        `commands through your shell using exactly this prefix: \`${browser}\`. Navigate to ` +
        `the page the issue is about and inspect it with \`snapshot -c\` before acting; prefer ` +
        `snapshot refs and semantic find commands over guessed CSS, and re-snapshot after the ` +
        `page changes. If the fix has no visible effect in the UI, set applicable=false and ` +
        `stop. Otherwise exercise the changed behavior, keep the final visible state on screen, ` +
        `run \`wait 1000\` so a human can see it, and set applicable=true and demonstrated=true ` +
        `only after you observed the expected result. Do not start or stop recording, take ` +
        `screenshots, close the browser, run git/gh, or edit files.`,
      { result: RecordingOutcome, signal },
    );

    await runBrowser(`screenshot ${shellQuote(`/tmp/issue-${n}.png`)}`);
    await runBrowser(`record stop`);
    recordingStarted = false;

    if (!outcome.applicable) return notApplicable(outcome.note || 'no visible UI change to demonstrate');
    if (!outcome.demonstrated) return failed(`agent could not demonstrate the change: ${outcome.note}`);

    const artifacts = await sh(`test -s /tmp/demo.webm && test -s /tmp/issue-${n}.png`);
    if (artifacts.exitCode !== 0) return failed('agent-browser produced no media');

    const gif = await sh(
      `ffmpeg -y -i /tmp/demo.webm -vf ` +
        `"fps=10,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" ` +
        `/tmp/issue-${n}.gif`,
    );
    const mp4 = await sh(`ffmpeg -y -i /tmp/demo.webm -movflags +faststart -pix_fmt yuv420p ` + `/tmp/issue-${n}.mp4`);
    const haveGif = gif.exitCode === 0;
    const haveMp4 = mp4.exitCode === 0;
    if (!haveGif && !haveMp4) return failed('ffmpeg produced no converted video');

    const media = await publishMedia(sh, gitRemote, {
      issueNumber: n,
      screenshotPath: `/tmp/issue-${n}.png`,
      gifPath: haveGif ? `/tmp/issue-${n}.gif` : undefined,
      mp4Path: haveMp4 ? `/tmp/issue-${n}.mp4` : undefined,
    });
    const comment =
      `\n\n**Verified in-browser:**` +
      (media.screenshotUrl ? `\n\n![screenshot](${media.screenshotUrl})` : '') +
      (media.gifUrl ? `\n\n![demo](${media.gifUrl})` : '') +
      (media.mp4Url ? `\n\n[Full-resolution recording](${media.mp4Url})` : '');
    return {
      applicable: true,
      recorded: true,
      refs: ['bot-media'],
      media,
      comment,
      note: outcome.note || 'recorded with agent-browser',
    };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    return failed(String(error));
  } finally {
    // Cleanup must still run after the submission signal has aborted.
    const cleanup = (command: string) => harness.sandbox.exec(command);
    if (recordingStarted) await cleanup(`${browser} record stop >/dev/null 2>&1 || true`);
    await cleanup(`${browser} close >/dev/null 2>&1 || true`);
    if (serverStarted) await cleanup(`kill $(cat /tmp/expense-rec.pid) >/dev/null 2>&1 || true`);
  }
}

type MediaInput = {
  issueNumber: number;
  screenshotPath?: string;
  gifPath?: string;
  mp4Path?: string;
};

/**
 * Commit per-issue media to the local orphan `bot-media` branch and return the
 * raw URLs it will be served from. The resolver pushes `bot-media` atomically
 * with the source commit.
 */
async function publishMedia(
  sh: (command: string) => Promise<ShellResult>,
  gitRemote: string,
  input: MediaInput,
): Promise<DemoResult['media']> {
  const slugResult = await sh(`gh repo view --json nameWithOwner --jq .nameWithOwner`);
  if (slugResult.exitCode !== 0) throw new Error(`gh repository lookup failed: ${commandError(slugResult)}`);
  const slug = slugResult.stdout.trim();
  if (!slug) throw new Error('gh repository lookup returned an empty name');

  const prepared = await prepareMedia(
    sh,
    gitRemote,
    input.issueNumber,
    Boolean(input.screenshotPath),
    Boolean(input.gifPath),
    Boolean(input.mp4Path),
  );
  if (prepared.exitCode !== 0) throw new Error(`media preparation failed: ${commandError(prepared)}`);

  const rawBase = `https://raw.githubusercontent.com/${slug}/bot-media`;
  return {
    screenshotUrl: input.screenshotPath ? `${rawBase}/issue-${input.issueNumber}.png` : undefined,
    gifUrl: input.gifPath ? `${rawBase}/issue-${input.issueNumber}.gif` : undefined,
    mp4Url: input.mp4Path ? `${rawBase}/issue-${input.issueNumber}.mp4` : undefined,
  };
}

/**
 * Prepare per-issue media on the local orphan `bot-media` branch using a git
 * worktree. Uses the already-configured bot git identity. Non-destructive to
 * other issues' files.
 */
async function prepareMedia(
  sh: (command: string) => Promise<ShellResult>,
  gitRemote: string,
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
      `if ${gitRemote} ls-remote --exit-code --heads origin bot-media >/dev/null 2>&1; then\n` +
      `  ${gitRemote} fetch origin bot-media\n` +
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
      `fi\n` +
      `cd -\n` +
      `git worktree remove --force /tmp/botmedia || true`,
  );
}
