import type { Github, GitHubIssue, IssueImage } from '../src/mastra/integrations/github.ts';

/** Every side effect the workflow attempted, in order. */
export type EvalAction =
  | { type: 'comment'; number: number; body: string }
  | { type: 'close'; number: number; reason: 'completed' | 'not planned' }
  | { type: 'push'; branch: string };

/**
 * Recording GitHub fake. Nothing leaves the process, so an eval can assert on
 * the exact set of side effects the workflow would have performed.
 */
export function createEvalGithub(
  issue: GitHubIssue,
  defaultBranch: string,
  actions: EvalAction[],
  /** Cases with screenshots supply pre-encoded bytes; nothing is downloaded. */
  images: IssueImage[] = [],
): Github {
  return {
    async getIssue() {
      return issue;
    },
    async fetchImages() {
      return images;
    },
    async getDefaultBranch() {
      return defaultBranch;
    },
    async comment(number, body) {
      actions.push({ type: 'comment', number, body });
    },
    async close(number, reason) {
      actions.push({ type: 'close', number, reason });
    },
    async push(branch) {
      actions.push({ type: 'push', branch });
    },
  };
}
