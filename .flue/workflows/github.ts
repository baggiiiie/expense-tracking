import { type FlueHarness, type PromptImage } from '@flue/runtime';

import { commandError, shellQuote, type ShellResult } from './shell.ts';

export type GitHubIssue = {
  /** Clean markdown for the agent: `Title: <title>\n\nBody: <body>`. */
  content: string;
  state: string;
  /** Attached feedback images, fetched and base64-encoded for the model. */
  images: PromptImage[];
};

// Only images committed to this exact repo path are fetched. A fixed, public
// prefix keeps issue-authored URLs from becoming an SSRF vector.
const ALLOWED_IMAGE_PREFIX = 'https://raw.githubusercontent.com/baggiiiie/expense-tracking/master/.feedback/';
const MAX_IMAGES = 6;

/** Pull allowlisted feedback-image URLs out of issue markdown. */
function extractImageUrls(markdown: string): string[] {
  const urls = new Set<string>();
  const patterns = [/!\[[^\]]*\]\((\S+?)\)/g, /<img[^>]+src=["']([^"']+)["']/gi];
  for (const re of patterns) {
    for (const match of markdown.matchAll(re)) {
      if (match[1].startsWith(ALLOWED_IMAGE_PREFIX)) urls.add(match[1]);
    }
  }
  return [...urls].slice(0, MAX_IMAGES);
}

/**
 * Deterministic GitHub + git-remote operations used by the resolver. This is a
 * dependency-injection seam: production wires {@link createProdGithub}; evals
 * and unit tests inject a fake implementation.
 */
export interface Github {
  getIssue(number: number): Promise<GitHubIssue>;
  getDefaultBranch(): Promise<string>;
  comment(number: number, body: string): Promise<void>;
  close(number: number, reason: 'completed' | 'not planned'): Promise<void>;
  /** Push HEAD to `branch` plus any extra refs (e.g. ['bot-media']) atomically. */
  push(branch: string, refs?: string[]): Promise<void>;
}

/**
 * Build a git command prefix that authenticates network operations without
 * leaking the token into the model's shell environment. actions/checkout runs
 * with persist-credentials disabled, so only application-owned git commands
 * carry an authorization header.
 */
export function credentialedGit(token = process.env.GH_TOKEN): string {
  return token
    ? `git -c http.https://github.com/.extraheader=${shellQuote(
        `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
      )}`
    : 'git';
}

/** Real GitHub integration used by the production issue resolver. */
export function createProdGithub(harness: FlueHarness, signal?: AbortSignal): Github {
  const token = process.env.GH_TOKEN;
  const sh = (command: string) =>
    harness.sandbox.exec(command, {
      signal,
      ...(token ? { env: { GH_TOKEN: token } } : {}),
    });
  const gitRemote = credentialedGit(token);
  const requireSuccess = (result: ShellResult, description: string): ShellResult => {
    if (result.exitCode !== 0) throw new Error(`${description} failed: ${commandError(result)}`);
    return result;
  };
  // Best-effort: download each allowlisted image and base64-encode it for the
  // model. A failed or non-image URL is skipped, never fatal.
  const fetchImages = async (urls: string[]): Promise<PromptImage[]> => {
    const images: PromptImage[] = [];
    for (const [index, url] of urls.entries()) {
      const path = `/tmp/issue-image-${index}`;
      const result = await sh(
        `curl -fsSL --max-filesize 5000000 --max-time 20 ` +
          (token ? `-H ${shellQuote(`Authorization: Bearer ${token}`)} ` : '') +
          `-o ${shellQuote(path)} -w '%{content_type}' ${shellQuote(url)}`,
      );
      const mimeType = result.stdout.trim();
      if (result.exitCode !== 0 || !/^image\/(png|jpe?g|gif|webp)$/.test(mimeType)) continue;
      const bytes = await harness.sandbox.readFileBuffer(path);
      images.push({ type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType });
    }
    return images;
  };

  return {
    async getIssue(number) {
      const result = requireSuccess(
        await sh(`gh issue view ${number} --json title,body,state`),
        `gh issue view ${number}`,
      );
      const raw = JSON.parse(result.stdout) as { title: string; body: string; state: string };
      return {
        content: `Title: ${raw.title}\n\nBody: ${raw.body}`,
        state: raw.state,
        images: await fetchImages(extractImageUrls(raw.body)),
      };
    },
    async getDefaultBranch() {
      const result = requireSuccess(
        await sh(`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`),
        'gh default-branch lookup',
      );
      const branch = result.stdout.trim();
      if (!branch) throw new Error('gh default-branch lookup returned an empty branch');
      return branch;
    },
    async comment(number, body) {
      const path = `/tmp/resolve-issue-${number}-comment.md`;
      await harness.sandbox.writeFile(path, body);
      requireSuccess(await sh(`gh issue comment ${number} --body-file ${shellQuote(path)}`), 'gh issue comment');
    },
    async close(number, reason) {
      requireSuccess(await sh(`gh issue close ${number} --reason ${shellQuote(reason)}`), 'gh issue close');
    },
    async push(branch, refs = []) {
      const refspecs = [`HEAD:${branch}`, ...refs.map((ref) => `${ref}:${ref}`)].map(shellQuote).join(' ');
      const atomic = refs.length > 0 ? '--atomic ' : '';
      requireSuccess(await sh(`${gitRemote} push ${atomic}origin ${refspecs}`), 'git push');
    },
  };
}
