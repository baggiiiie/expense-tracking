import { Agent } from '@mastra/core/agent';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';

import { model } from '../model.ts';
import { resolveResolutionContext } from '../runtime.ts';

/**
 * Triage judge. Deliberately has no workspace: classification is pure judgment
 * over the issue text, and withholding tools makes it impossible for this step
 * to touch the repository.
 */
export const triageAgent = new Agent({
  id: 'issue-triage',
  name: 'issue-triage',
  instructions:
    'You triage GitHub issues for a personal expense-tracking project (Go server, Svelte web UI, iOS app). ' +
    'Classify each issue into exactly one category and give a concise, author-facing reason. ' +
    'Use "invalid" for issues with no actionable content, "unclear" when the report is plausible but ' +
    'underspecified, "duplicate" only with concrete evidence of an existing issue, and "stale" for ' +
    'issues that no longer apply. Prefer "bug" or "feature" whenever there is a concrete, actionable change.',
  model,
});

/** `npm run verify` builds the Go server and the web bundle. */
const VERIFY_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * OS-level containment for the agent's shell, on by default.
 *
 * The prompt tells the agent not to push or to run `gh`, but a prompt is not an
 * enforcement mechanism, so the sandbox is what actually holds: the environment
 * carries no GitHub token (see `checkoutEnv`) and writes are confined to the
 * checkout and the toolchain caches. Network stays open because `npm run verify`
 * installs dependencies.
 */
function isolation(): 'none' | 'seatbelt' | 'bwrap' {
  const override = process.env.RESOLVER_SANDBOX_ISOLATION;
  if (override === 'none' || override === 'seatbelt' || override === 'bwrap') return override;
  return process.platform === 'darwin' ? 'seatbelt' : 'bwrap';
}

/**
 * The coding agent's sandbox and filesystem are resolved per request so the same
 * agent instance serves both production (the CI checkout) and evals (a
 * disposable clone with an isolated git identity).
 */
const workspace = new Workspace({
  id: 'issue-resolver-workspace',
  filesystem: ({ requestContext }) => {
    const { workingDirectory } = resolveResolutionContext(requestContext);
    return new LocalFilesystem({ basePath: workingDirectory });
  },
  sandbox: ({ requestContext }) => {
    const { workingDirectory, env } = resolveResolutionContext(requestContext);
    return new LocalSandbox({
      workingDirectory,
      env,
      timeout: VERIFY_TIMEOUT_MS,
      isolation: isolation(),
      nativeSandbox: {
        allowNetwork: true,
        readWritePaths: [env.HOME, env.TMPDIR].filter((path): path is string => Boolean(path)),
      },
    });
  },
  // Background processes must stay reachable across tool calls within a run.
  sandboxCacheKey: ({ requestContext }) => resolveResolutionContext(requestContext).id,
});

export const coderAgent = new Agent({
  id: 'issue-coder',
  name: 'issue-coder',
  instructions:
    'You are a precise software engineer for this repository. Make the smallest correct change that ' +
    'addresses the task, and do not refactor unrelated code. Read files before editing them. ' +
    'Commit your work with git, leaving no uncommitted changes behind. Never run `git push`, never ' +
    'run any `gh` command, and never close an issue: the workflow owns pushing and closing.',
  model,
  workspace,
});
