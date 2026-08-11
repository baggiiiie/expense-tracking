import * as v from 'valibot';

import { createProdGithub, type Github } from './integrations/github.ts';
import { mastra } from './index.ts';
import { resolutionRequestContext } from './runtime.ts';
import { Result, type Payload, type ResultType } from './workflows/schemas.ts';

export type ResolveOptions = {
  /** Override the GitHub integration (tests and dry runs inject a fake). */
  github?: Github;
  workingDirectory?: string;
  signal?: AbortSignal;
};

/**
 * Run the Mastra resolve-issue workflow once.
 *
 * Dependencies are request-scoped, so concurrent production and eval runs can
 * use different GitHub adapters and checkouts without shared mutable state.
 */
export async function resolveIssue(payload: Payload, options: ResolveOptions = {}): Promise<ResultType> {
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const requestContext = resolutionRequestContext({
    github: options.github ?? createProdGithub({ cwd: workingDirectory, signal: options.signal }),
    workingDirectory,
    signal: options.signal,
  });

  const run = await mastra.getWorkflow('resolveIssueWorkflow').createRun();
  const cancel = () => void run.cancel();
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (options.signal?.aborted) await run.cancel();
    const outcome = await run.start({ inputData: payload, requestContext });

    if (outcome.status !== 'success') {
      const detail =
        outcome.status === 'failed' ? (outcome.error?.message ?? String(outcome.error)) : `status=${outcome.status}`;
      throw new Error(`resolve-issue workflow did not succeed: ${detail}`);
    }
    return v.parse(Result, outcome.result);
  } finally {
    options.signal?.removeEventListener('abort', cancel);
  }
}
