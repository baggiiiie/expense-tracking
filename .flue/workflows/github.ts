import { type FlueHarness } from '@flue/runtime';

import { commandError, shellQuote, type ShellResult } from './resolve-issue.ts';

export type GitHubIssue = {
  number: number;
  title: string;
  body: string;
  labels?: { name: string }[];
  comments?: { body?: string }[];
  state?: string;
  updatedAt?: string;
};

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

  return {
    async getIssue(number) {
      const result = requireSuccess(
        await sh(`gh issue view ${number} --json number,title,body,labels,comments,state,updatedAt`),
        `gh issue view ${number}`,
      );
      return JSON.parse(result.stdout) as GitHubIssue;
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
