import type { Github, GitHubIssue } from '../workflows/resolve-issue.ts';

export type EvalAction =
  | { type: 'comment'; number: number; body: string }
  | { type: 'close'; number: number; reason: 'completed' | 'not planned' }
  | { type: 'push'; branch: string }
  | { type: 'publish-media'; issueNumber: number };

export function createEvalGithub(
  issue: GitHubIssue,
  defaultBranch: string,
  actions: EvalAction[],
): Github {
  return {
    async getIssue(number) {
      if (number !== issue.number) throw new Error(`unexpected issue number ${number}`);
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
    async publishMedia(input) {
      actions.push({ type: 'publish-media', issueNumber: input.issueNumber });
      return {
        screenshotUrl: input.screenshotPath ? 'eval://screenshot' : undefined,
        gifUrl: input.gifPath ? 'eval://demo.gif' : undefined,
        mp4Url: input.mp4Path ? 'eval://demo.mp4' : undefined,
      };
    },
  };
}
