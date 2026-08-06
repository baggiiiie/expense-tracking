import { describe, expect, it } from 'vitest';

import { listCases } from './eval-case.ts';
import { runCase } from './run-case.ts';

// local() is not filesystem or network containment. Run model-backed evals only
// on a credential-clean, disposable CI runner, orb, container, or VM.
if (process.env.CI !== 'true' && process.env.FLUE_EVAL_DISPOSABLE !== '1') {
  throw new Error(
    'Resolver evals use local() and must run in a disposable CI runner/container/VM. ' +
      'Set FLUE_EVAL_DISPOSABLE=1 only inside such an environment.',
  );
}

const keepWorkspace = process.env.EVAL_KEEP_WORKSPACE === '1';
const cases = await listCases();

describe.sequential('issue resolver', () => {
  it.each(cases)('%s', async (name) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required to run resolver evals');
    }

    const report = await runCase(name, keepWorkspace);
    expect(report, JSON.stringify(report, null, 2)).toMatchObject({
      passed: true,
    });
  });
});
