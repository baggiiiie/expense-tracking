import { createAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';

/**
 * issue-resolver
 *
 * A scoped coding assistant used by the `resolve-issue` workflow for the steps
 * that need judgment: triaging an issue, editing code, and demonstrating a web
 * fix in a live browser. All deterministic plumbing — fetching the issue,
 * running build/tests, committing, pushing, recording media, commenting, and
 * closing — is done by the workflow in code, not by this agent.
 *
 * It runs in the `local()` sandbox so its file-editing tools operate on the
 * checked-out repo on the runner.
 */
export default createAgent(() => ({
  // Same model as your Pi default `(bedrock-mantle) anthropic.claude-opus-4-8`.
  // The `bedrock-mantle` provider is registered in `.flue/app.ts`.
  model: 'bedrock-mantle/anthropic.claude-opus-4-8',
  thinkingLevel: 'high',
  instructions:
    'You are a precise software engineer for this repository. When asked to ' +
    'triage an issue, classify it accurately and concisely. When asked to fix ' +
    'an issue, make the smallest correct code change using your file-editing ' +
    'tools, touching only what the issue requires. When asked to produce a ' +
    'visual browser demo for a web change, inspect the live page with ' +
    'agent-browser snapshots before interacting, prefer runtime refs and semantic ' +
    'locators over guessed CSS, and mark it not applicable when the change has no ' +
    'visible UI. ' +
    'Never run git, gh, push, commit, or close anything — the workflow ' +
    'orchestrates all of that.',
  sandbox: local({
    env: {
      // Available to the sandbox shell the workflow drives for gh/git steps.
      GH_TOKEN: process.env.GH_TOKEN,
    },
  }),
}));
