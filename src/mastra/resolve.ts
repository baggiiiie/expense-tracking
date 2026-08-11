import * as v from 'valibot';

import { createProdGithub, type Github } from './integrations/github.ts';
import { mastra } from './index.ts';
import {
  registerResolutionContext,
  resolutionRequestContext,
  unregisterResolutionContext,
  type ResolutionContext,
} from './runtime.ts';
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
 * The workflow reads its dependencies from a registered resolution context, so
 * this function owns registering and tearing that down. Retrieving the workflow
 * through `mastra.getWorkflow()` rather than importing it directly gives the run
 * the instance's logger, storage, and telemetry.
 */
export async function resolveIssue(payload: Payload, options: ResolveOptions = {}): Promise<ResultType> {
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const context: ResolutionContext = registerResolutionContext({
    github: options.github ?? createProdGithub({ cwd: workingDirectory, signal: options.signal }),
    workingDirectory,
  });

  try {
    const run = await mastra.getWorkflow('resolveIssueWorkflow').createRun();
    const outcome = await run.start({
      inputData: { issueNumber: payload.issueNumber },
      requestContext: resolutionRequestContext(context),
    });

    if (outcome.status !== 'success') {
      const detail =
        outcome.status === 'failed' ? (outcome.error?.message ?? String(outcome.error)) : `status=${outcome.status}`;
      throw new Error(`resolve-issue workflow did not succeed: ${detail}`);
    }
    return v.parse(Result, outcome.result);
  } finally {
    unregisterResolutionContext(context.id);
  }
}
