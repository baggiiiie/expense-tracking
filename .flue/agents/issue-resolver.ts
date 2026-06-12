import { createAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';

/**
 * issue-resolver
 *
 * A scoped coding assistant used by the `resolve-issue` workflow for the two
 * steps that actually need a model: triaging an issue (judgment) and editing
 * code to fix it. All deterministic plumbing — fetching the issue, running the
 * build/tests, committing, pushing, commenting, and closing — is done by the
 * workflow in code, not by this agent.
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
    'tools, touching only what the issue requires. Never run git, gh, push, ' +
    'commit, or close anything — the workflow orchestrates all of that.',
  sandbox: local({
    env: {
      // Available to the sandbox shell the workflow drives for gh/git steps.
      GH_TOKEN: process.env.GH_TOKEN,
    },
  }),
}));
