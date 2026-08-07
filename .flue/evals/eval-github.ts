import type { Github, GitHubIssue } from '../workflows/github.ts';

export type EvalAction =
  | { type: 'comment'; number: number; body: string }
  | { type: 'close'; number: number; reason: 'completed' | 'not planned' }
  | { type: 'push'; branch: string };

export function createEvalGithub(
  issue: GitHubIssue,
  defaultBranch: string,
  actions: EvalAction[],
): Github {
  return {
    async getIssue() {
      return issue;
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
