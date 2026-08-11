import { RequestContext } from '@mastra/core/request-context';

import type { Github } from './integrations/github.ts';

/**
 * Per-run dependency seam for the Mastra resolver.
 *
 * Mastra resolves a workspace and reads tools per request via `requestContext`.
 * Production passes a real GitHub integration and checkout; evals pass a
 * recording fake and disposable clone to the same workflow graph.
 */
export type ResolutionContext = {
  /** Owns every GitHub side effect, and the only holder of the GitHub token. */
  github: Github;
  /** Absolute path to the checkout the coding agent may edit. */
  workingDirectory: string;
  /**
   * Environment for every command run in the checkout, by the workflow and by
   * the coding agent alike. Always scrubbed — see {@link checkoutEnv}.
   */
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Override the production build command for focused tests and eval cases. */
  verifyCommand?: string;
};

const RESOLUTION_CONTEXT_KEY = 'issue-resolution' as const;

/**
 * Variables a build needs, allowlisted from the ambient environment.
 *
 * The coding agent runs shell commands in the checkout, so anything reachable
 * in its environment is effectively readable by the model and by any code the
 * issue talked it into running. An allowlist means a newly added secret is
 * excluded by default instead of leaking until someone notices.
 *
 * Nothing here grants GitHub access: the token lives only in the environment
 * `createProdGithub` builds for its own shell, and reaches the network through
 * an inline git header, so it is never present in the checkout's environment.
 */
const PASSTHROUGH = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TERM',
  'TMPDIR',
  // Toolchain caches; without these a build re-downloads everything.
  'GOCACHE',
  'GOMODCACHE',
  'GOPATH',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'npm_config_cache',
  'PNPM_HOME',
  'XDG_CACHE_HOME',
] as const;

export function checkoutEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of PASSTHROUGH) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  // Never block on an interactive credential prompt inside an unattended run.
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

/** Build the per-run dependency context consumed by the workflow. */
export function resolutionRequestContext(
  context: Omit<ResolutionContext, 'env'> & { env?: NodeJS.ProcessEnv },
): RequestContext<any> {
  return new RequestContext([[RESOLUTION_CONTEXT_KEY, { ...context, env: checkoutEnv(context.env) }]]);
}

export function resolveResolutionContext(requestContext?: RequestContext): ResolutionContext {
  const context = requestContext?.get(RESOLUTION_CONTEXT_KEY) as ResolutionContext | undefined;
  if (!context) throw new Error(`resolve-issue requires a "${RESOLUTION_CONTEXT_KEY}" request context value`);
  return context;
}
