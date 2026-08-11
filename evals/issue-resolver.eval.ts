import { describe, expect, it } from 'vitest';

import { listCases } from '../src/shared/issue-resolution.ts';
import { runCase } from './run-case.ts';

/**
 * The coding agent's sandbox confines writes to the checkout, but these evals
 * still run real builds and real model calls against a clone, so they belong on
 * a credential-clean, disposable CI runner, container, or VM.
 */
if (process.env.CI !== 'true' && process.env.MASTRA_EVAL_DISPOSABLE !== '1') {
  throw new Error(
    'Resolver evals run builds and model calls against a checkout, and must run in a disposable ' +
      'CI runner/container/VM. Set MASTRA_EVAL_DISPOSABLE=1 only inside such an environment.',
  );
}

const keepWorkspace = process.env.EVAL_KEEP_WORKSPACE === '1';
const cases = await listCases();

describe.sequential('issue resolver (mastra)', () => {
  it.each(cases)('%s', async (name) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required to run resolver evals');
    }

    const report = await runCase(name, keepWorkspace);
    const detail = JSON.stringify(report, null, 2);

    // Gates are hard invariants (side-effect discipline, clean tree); a failing
    // gate is a correctness bug. Graded scorers are asserted separately so a
    // quality regression is distinguishable from a broken workflow.
    expect(report.error, detail).toBeUndefined();
    expect(report.gateFailures, detail).toEqual([]);
    expect(report.scores['triage-accuracy'], detail).toBe(1);
    expect(report.scores['case-verification'], detail).toBe(1);
    expect(report.scores['patch-accuracy'], detail).toBeGreaterThan(0);
  });
});
