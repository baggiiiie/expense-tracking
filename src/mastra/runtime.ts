import { RequestContext } from '@mastra/core/request-context';

import type { Github } from './integrations/github.ts';

/**
 * Per-run dependency seam for the Mastra resolver.
 *
 * Mastra resolves a workspace and reads tools per request via `requestContext`,
 * so injecting dependencies means putting a lookup key on the context rather
 * than passing a deps object down a call chain (as the Flue resolver does).
 * Production registers a real GitHub integration and the repo checkout; evals
 * register a recording fake and a disposable clone, which is what lets the same
 * workflow graph run under `runEvals` with no side effects.
 */
export type ResolutionContext = {
  id: string;
  /** Owns every GitHub side effect, and the only holder of the GitHub token. */
  github: Github;
  /** Absolute path to the checkout the coding agent may edit. */
  workingDirectory: string;
  /**
   * Environment for every command run in the checkout, by the workflow and by
   * the coding agent alike. Always scrubbed — see {@link checkoutEnv}.
   */
  env: NodeJS.ProcessEnv;
};

const RESOLUTION_CONTEXT_KEY = 'issue-resolution-id';

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

const registry = new Map<string, ResolutionContext>();

export function registerResolutionContext(
  context: Omit<ResolutionContext, 'id' | 'env'> & { id?: string; env?: NodeJS.ProcessEnv },
): ResolutionContext {
  const id = context.id ?? `resolution-${crypto.randomUUID()}`;
  const registered: ResolutionContext = { ...context, id, env: checkoutEnv(context.env) };
  registry.set(id, registered);
  return registered;
}

export function unregisterResolutionContext(id: string): void {
  registry.delete(id);
}

/** A RequestContext that points the workflow at a registered resolution context. */
export function resolutionRequestContext(context: ResolutionContext): RequestContext {
  return new RequestContext([[RESOLUTION_CONTEXT_KEY, context.id]]);
}

export function resolveResolutionContext(requestContext?: RequestContext): ResolutionContext {
  const id = requestContext?.get(RESOLUTION_CONTEXT_KEY);
  if (typeof id !== 'string') {
    throw new Error(
      `resolve-issue requires a "${RESOLUTION_CONTEXT_KEY}" request context value; ` +
        'start the run through resolveIssue() or the eval harness',
    );
  }
  const context = registry.get(id);
  if (!context) throw new Error(`unknown issue-resolution context: ${id}`);
  return context;
}
