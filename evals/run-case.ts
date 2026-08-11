import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { runEvals } from '@mastra/core/evals';

import { loadCase, type EvalCase } from '../src/shared/issue-resolution.ts';
import { mastra } from '../src/mastra/index.ts';
import type { GitHubIssue } from '../src/mastra/integrations/github.ts';
import {
  registerResolutionContext,
  resolutionRequestContext,
  unregisterResolutionContext,
} from '../src/mastra/runtime.ts';
import type { ResultType } from '../src/mastra/workflows/schemas.ts';
import { createEvalGithub, type EvalAction } from './eval-github.ts';
import { cleanupRepository, createRepository, type RepositoryFixture } from './repository-fixture.ts';
import { createResolverScorers, type Evidence } from './scorers.ts';

type VerificationCheck = { command: string; passed: boolean; output: string };

export type CaseReport = {
  case: string;
  /** Empty when every hard invariant held. */
  gateFailures: { id: string; score: number }[];
  /** Every gate and scorer, flattened by scorer id. */
  scores: Record<string, number>;
  result?: ResultType;
  actions?: EvalAction[];
  diff?: string;
  status?: string;
  verification?: VerificationCheck[];
  workspace?: string;
  error?: string;
};

async function runCaseVerification(
  repository: RepositoryFixture,
  testCase: EvalCase,
): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];
  for (const command of testCase.verify) {
    const result = await repository.shell(command, { timeoutMs: 10 * 60 * 1000 });
    checks.push({
      command,
      passed: result.exitCode === 0,
      output: (result.stderr || result.stdout).trim().slice(-2000),
    });
  }
  return checks;
}

/**
 * Evaluate one case through Mastra's `runEvals`.
 *
 * The workflow is the eval target, so scorers see the real graph: the same
 * steps, branch decisions, and side-effect discipline that production runs.
 * Everything external is swapped out underneath it — a disposable clone for the
 * checkout, a recording fake for GitHub — via the resolution context.
 *
 * `runEvals` only accepts a `gates` option for agent targets, so the gates run
 * here as ordinary workflow scorers and their verdict is computed from the
 * returned scores. That also keeps every score in one flat shape.
 */
export async function runCase(name: string, keepWorkspace: boolean): Promise<CaseReport> {
  const { directory, value: testCase } = await loadCase(name);
  let repository: RepositoryFixture | undefined;
  let gatesPassed = false;
  // Shared with the error path, so a mid-run failure still reports what it got.
  const collected: {
    evidence?: Evidence;
    verification?: VerificationCheck[];
    result?: ResultType;
    actions: EvalAction[];
  } = { actions: [] };

  try {
    repository = await createRepository(name, testCase);
    const fixture = repository;
    const actions = collected.actions;
    const issue: GitHubIssue = {
      content: `Title: ${testCase.issue.title}\n\nBody: ${testCase.issue.body}`,
      state: 'OPEN',
      imageUrls: [],
    };
    const context = registerResolutionContext({
      id: `eval-${name}-${Date.now()}`,
      github: createEvalGithub(issue, testCase.repository.defaultBranch, actions),
      workingDirectory: fixture.workspace,
      env: fixture.env,
    });

    const { gates, workflow, steps } = createResolverScorers(async () => {
      const diff = await fixture.shell(`git diff --no-ext-diff --binary ${fixture.initialSha}`, {
        timeoutMs: 60_000,
      });
      const status = await fixture.shell('git status --porcelain=v1 --untracked-files=all');
      collected.verification = await runCaseVerification(fixture, testCase);
      collected.evidence = {
        testCase,
        expectedPatch: await readFile(path.join(directory, testCase.expectedPatch), 'utf8'),
        actions,
        diff: diff.stdout,
        status: status.stdout.trim(),
        caseVerificationPassed: collected.verification.every((check) => check.passed),
      };
      return collected.evidence;
    });

    try {
      const outcome = await runEvals({
        target: mastra.getWorkflow('resolveIssueWorkflow'),
        data: [
          {
            input: { issueNumber: testCase.issue.number },
            groundTruth: testCase.expected,
            requestContext: resolutionRequestContext(context),
          },
        ],
        scorers: { workflow: [...gates, ...workflow], steps },
        onItemComplete: ({ targetResult }) => {
          if (targetResult.status === 'success') collected.result = targetResult.result as ResultType;
        },
      });

      // Workflow scores nest under `workflow` and `steps`; flatten by scorer id
      // so callers assert on `scores['triage-accuracy']` regardless of level.
      const scores: Record<string, number> = { ...(outcome.scores.workflow ?? {}) };
      for (const stepScores of Object.values(outcome.scores.steps ?? {})) {
        Object.assign(scores, stepScores);
      }

      const gateFailures = gates
        .map((gate) => ({ id: gate.id, score: scores[gate.id] ?? 0 }))
        .filter((gate) => gate.score < 1);
      gatesPassed = gateFailures.length === 0;

      // Every scorer awaited the same memoized snapshot, so the evidence in the
      // report is exactly what was scored rather than a second, later read.
      return {
        case: name,
        gateFailures,
        scores,
        result: collected.result,
        actions,
        diff: collected.evidence?.diff,
        status: collected.evidence?.status,
        verification: collected.verification,
        workspace: keepWorkspace || !gatesPassed ? fixture.workspace : undefined,
      };
    } finally {
      unregisterResolutionContext(context.id);
    }
  } catch (error) {
    return {
      case: name,
      // A thrown error is a harness or workflow failure, not a gate result; the
      // caller asserts on `error` first so this is not mistaken for a pass.
      gateFailures: [],
      scores: {},
      // Report whatever evidence was gathered before the failure — a run that
      // died mid-scoring is exactly when the diff and actions matter most.
      result: collected.result,
      actions: collected.actions,
      diff: collected.evidence?.diff,
      status: collected.evidence?.status,
      verification: collected.verification,
      workspace: repository?.workspace,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (repository && !keepWorkspace && gatesPassed) await cleanupRepository(repository);
  }
}
