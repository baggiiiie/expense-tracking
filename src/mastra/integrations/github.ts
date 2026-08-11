import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { commandError, createShell, shellQuote, type Shell, type ShellResult } from './shell.ts';

export type GitHubIssue = {
  /** Clean markdown for the agent: `Title: <title>\n\nBody: <body>`. */
  content: string;
  state: string;
  /**
   * Allowlisted feedback-image URLs found in the body, in order.
   *
   * Only the URLs travel between steps; the bytes are fetched at prompt time by
   * {@link Github.fetchImages}. A base64 blob here would be copied into every
   * workflow snapshot, step payload, and eval failure dump.
   */
  imageUrls: string[];
};

/** An image in the shape the model's message content expects. */
export type IssueImage = {
  /** Base64-encoded bytes. */
  image: string;
  /** IANA media type. Named `mediaType` to match AI SDK v5's `ImagePart`. */
  mediaType: string;
};

// Only images committed to this exact repo path are fetched. A fixed, public
// prefix keeps issue-authored URLs from becoming an SSRF vector, and is what
// makes it safe to send the GitHub token as a request header.
const ALLOWED_IMAGE_PREFIX = 'https://raw.githubusercontent.com/baggiiiie/expense-tracking/master/.feedback/';
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5_000_000;
const IMAGE_TIMEOUT_MS = 20_000;
const ALLOWED_IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp)$/;

/** Pull allowlisted feedback-image URLs out of issue markdown. */
export function extractImageUrls(markdown: string): string[] {
  const urls = new Set<string>();
  const patterns = [/!\[[^\]]*\]\((\S+?)\)/g, /<img[^>]+src=["']([^"']+)["']/gi];
  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      if (match[1].startsWith(ALLOWED_IMAGE_PREFIX)) urls.add(match[1]);
    }
  }
  return [...urls].slice(0, MAX_IMAGES);
}

/**
 * Read a response body, giving up as soon as it exceeds `limit`.
 *
 * Returns null when the body is too large, so an unbounded or lying
 * `content-length` cannot be turned into unbounded memory use.
 */
async function readCapped(response: Response, limit: number): Promise<Buffer | null> {
  if (!response.body) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Deterministic GitHub + git-remote operations, kept out of the model's reach.
 *
 * The workflow owns every side effect (comment, close, push) so that a model
 * mistake cannot publish anything. Evals inject a recording fake; production
 * injects {@link createProdGithub}.
 */
export interface Github {
  getIssue(number: number): Promise<GitHubIssue>;
  /** Download and base64-encode issue images. Best-effort: bad URLs are skipped. */
  fetchImages(urls: string[]): Promise<IssueImage[]>;
  getDefaultBranch(): Promise<string>;
  comment(number: number, body: string): Promise<void>;
  close(number: number, reason: 'completed' | 'not planned'): Promise<void>;
  /** Push HEAD to `branch`. */
  push(branch: string): Promise<void>;
}

/**
 * Authenticate git network operations via an inline header instead of a remote
 * URL or global config, so the token never lands in the checkout the coding
 * agent can read.
 */
function credentialedGit(token = process.env.GH_TOKEN): string {
  return token
    ? `git -c http.https://github.com/.extraheader=${shellQuote(
        `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
      )}`
    : 'git';
}

export function createProdGithub(options: {
  cwd: string;
  signal?: AbortSignal;
  /** Override the command runner; tests inject a fake instead of spawning `gh`. */
  shell?: Shell;
}): Github {
  const token = process.env.GH_TOKEN;
  // The token lives only in this shell's environment. The checkout the coding
  // agent can read gets a scrubbed environment (see `checkoutEnv`), so GitHub
  // credentials are never reachable from model-driven commands.
  const shell: Shell =
    options.shell ??
    createShell({
      cwd: options.cwd,
      env: { ...process.env, ...(token ? { GH_TOKEN: token } : {}) },
      signal: options.signal,
    });
  const gitRemote = credentialedGit(token);
  const requireSuccess = (result: ShellResult, description: string): ShellResult => {
    if (result.exitCode !== 0) throw new Error(`${description} failed: ${commandError(result)}`);
    return result;
  };
  return {
    async getIssue(number) {
      const result = requireSuccess(
        await shell(`gh issue view ${number} --json title,body,state`),
        `gh issue view ${number}`,
      );
      const raw = JSON.parse(result.stdout) as { title: string; body: string; state: string };
      return {
        content: `Title: ${raw.title}\n\nBody: ${raw.body}`,
        state: raw.state,
        imageUrls: extractImageUrls(raw.body),
      };
    },
    async fetchImages(urls) {
      const images: IssueImage[] = [];
      for (const url of urls) {
        // Re-check the allowlist here rather than trusting the caller: this is
        // the function that actually performs the request.
        if (!url.startsWith(ALLOWED_IMAGE_PREFIX)) continue;
        // Honour both the per-image timeout and the caller's cancellation, so an
        // aborted run stops downloading instead of finishing the whole list.
        const timeout = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        try {
          const response = await fetch(url, {
            redirect: 'error',
            signal,
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (!response.ok) continue;
          const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
          if (!ALLOWED_IMAGE_TYPES.test(mediaType)) continue;
          // Trust the declared length when it is present, and cap the read
          // itself otherwise: buffering the whole body first would make
          // MAX_IMAGE_BYTES a post-hoc check rather than a memory bound.
          const declared = Number(response.headers.get('content-length'));
          if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) continue;
          const bytes = await readCapped(response, MAX_IMAGE_BYTES);
          if (!bytes) continue;
          images.push({ image: bytes.toString('base64'), mediaType });
        } catch {
          // A missing, slow, or oversized image must never fail triage.
          if (options.signal?.aborted) break;
        }
      }
      return images;
    },
    async getDefaultBranch() {
      const result = requireSuccess(
        await shell(`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`),
        'gh default-branch lookup',
      );
      const branch = result.stdout.trim();
      if (!branch) throw new Error('gh default-branch lookup returned an empty branch');
      return branch;
    },
    async comment(number, body) {
      // Write the body to a file rather than interpolating it into the command:
      // model-authored markdown contains backticks and quotes that the shell
      // would otherwise reinterpret.
      const path = `${tmpdir()}/mastra-resolve-issue-${number}-comment.md`;
      await writeFile(path, body, 'utf8');
      requireSuccess(
        await shell(`gh issue comment ${number} --body-file ${shellQuote(path)}`),
        'gh issue comment',
      );
    },
    async close(number, reason) {
      requireSuccess(await shell(`gh issue close ${number} --reason ${shellQuote(reason)}`), 'gh issue close');
    },
    async push(branch) {
      requireSuccess(await shell(`${gitRemote} push origin ${shellQuote(`HEAD:${branch}`)}`), 'git push');
    },
  };
}
