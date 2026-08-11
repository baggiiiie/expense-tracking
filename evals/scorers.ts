import { createScorer, type MastraScorer } from '@mastra/core/evals';

import { normalizePatch, type EvalCase } from '../src/shared/issue-resolution.ts';
import type { ResultType, TriageType } from '../src/mastra/workflows/schemas.ts';
import type { EvalAction } from './eval-github.ts';

/**
 * Scorers for the resolve-issue workflow.
 *
 * Split into gates (hard invariants that must hold) and graded scorers (quality
 * that can regress by degrees), so a failure is attributable to a stage instead
 * of collapsing into one boolean the way the Flue harness did.
 *
 * Scorers are built per case around a lazy `evidence()` thunk rather than
 * reading a module-global map. `runEvals` runs every scorer *before* it calls
 * `onItemComplete`, so evidence recorded from that callback is never visible to
 * scoring; collecting it on first use is what makes the reads correct, and
 * memoizing means all scorers still see one consistent snapshot.
 */
export type Evidence = {
  testCase: EvalCase;
  expectedPatch: string;
  /** Every side effect the workflow attempted, in order. */
  actions: EvalAction[];
  /** Diff of the working tree against the base commit. */
  diff: string;
  /** `git status --porcelain` output; empty means clean. */
  status: string;
  /** Whether the case's own verify commands passed in the final tree. */
  caseVerificationPassed: boolean;
};

const binary = (passed: boolean): number => (passed ? 1 : 0);

/** Collect once, then serve the same snapshot to every scorer. */
function memoize(collect: () => Promise<Evidence>): () => Promise<Evidence> {
  let pending: Promise<Evidence> | undefined;
  return () => (pending ??= collect());
}

/**
 * A built scorer. The builder methods return progressively richer generic
 * parameters, so the loose form is what lets gates and scorers share a list.
 */
type Scorer = MastraScorer<string, any, any, any>;

export type ResolverScorers = {
  /** Must all score 1: side-effect discipline and a clean tree. */
  gates: Scorer[];
  /** Graded quality signals, scored against the final workflow output. */
  workflow: Scorer[];
  /** Graded signals attributed to the step that produced them. */
  steps: Record<string, Scorer[]>;
};

export function createResolverScorers(collect: () => Promise<Evidence>): ResolverScorers {
  const evidence = memoize(collect);
  const resultOf = (output: unknown) => output as ResultType;

  /** Gate: the model must not leave uncommitted edits behind. */
  const cleanTree = createScorer({
    id: 'clean-tree',
    description: 'The working tree is clean after the run (no stray uncommitted edits).',
  }).generateScore(async () => binary((await evidence()).status === ''));

  /** Gate: push exactly when the case expects it, and only to the default branch. */
  const pushDiscipline = createScorer({
    id: 'push-discipline',
    description: 'The workflow pushed exactly when expected, and only to the default branch.',
  }).generateScore(async () => {
    const { testCase, actions } = await evidence();
    const pushes = actions.filter((action) => action.type === 'push');
    return binary(
      testCase.expected.shouldPush
        ? pushes.length === 1 && pushes[0]?.branch === testCase.repository.defaultBranch
        : pushes.length === 0,
    );
  });

  /** Gate: close exactly once, with the reason the case expects. */
  const closeDiscipline = createScorer({
    id: 'close-discipline',
    description: 'The workflow closed the issue exactly when expected, with the right reason.',
  }).generateScore(async () => {
    const { testCase, actions } = await evidence();
    const closes = actions.filter((action) => action.type === 'close');
    const expectedReason = testCase.expected.shouldPush ? 'completed' : 'not planned';
    return binary(
      testCase.expected.shouldClose
        ? closes.length === 1 &&
            closes[0]?.number === testCase.issue.number &&
            closes[0]?.reason === expectedReason
        : closes.length === 0,
    );
  });

  /**
   * Gate: the workflow's verdict must match what the tree can actually do.
   *
   * The workflow now runs the build itself, so this compares two independent
   * measurements of the same tree — the workflow's and the harness's — rather
   * than grading the coding agent's self-report against expectations.
   */
  const verificationHonesty = createScorer({
    id: 'verification-honesty',
    description: "The workflow's verification verdict matches the harness's own check of the tree.",
  }).generateScore(async ({ run }) => {
    const { caseVerificationPassed, testCase } = await evidence();
    const { verification } = resultOf(run.output);
    return binary(
      verification.passed === testCase.expected.shouldPush && verification.passed === caseVerificationPassed,
    );
  });

  /** Gate: the author always hears back, whatever the outcome. */
  const authorFeedback = createScorer({
    id: 'author-feedback',
    description: 'The issue author always receives at least one comment.',
  }).generateScore(async () => {
    const { actions } = await evidence();
    return binary(actions.some((action) => action.type === 'comment' && action.body.trim().length > 0));
  });

  /**
   * Scored, on the `triage` step: did classification pick the expected category?
   *
   * Attached to the step rather than the workflow output, so a triage regression
   * is reported against triage even when a later stage also fails.
   */
  const triageAccuracy = createScorer({
    id: 'triage-accuracy',
    description: 'Triage assigned the category the case expects.',
  })
    .generateScore(async ({ run }) => {
      const { testCase } = await evidence();
      const { triage } = run.output as { triage: TriageType };
      return binary(triage?.category === testCase.expected.triage);
    })
    .generateReason(async ({ run, score }) => {
      const { testCase } = await evidence();
      const { triage } = run.output as { triage: TriageType };
      return score === 1
        ? `triaged as "${triage.category}" as expected`
        : `expected "${testCase.expected.triage}" but got "${triage?.category}": ${triage?.reason}`;
    });

  /**
   * Scored: how close is the produced patch to the reference fix?
   *
   * Graded rather than binary. There are many correct ways to write the same fix,
   * so an exact match is the ceiling and not the bar; the partial score is the
   * fraction of expected changed lines that appear in the actual diff, which
   * distinguishes "solved it differently" from "changed the wrong thing".
   */
  const patchAccuracy = createScorer({
    id: 'patch-accuracy',
    description: 'Overlap between the produced diff and the reference patch.',
  })
    .generateScore(async () => {
      const { diff, expectedPatch } = await evidence();
      const expected = normalizePatch(expectedPatch);
      const actual = normalizePatch(diff);
      if (expected === actual) return 1;

      const changedLines = (patch: string) =>
        patch
          .split('\n')
          .filter(
            (line) =>
              (line.startsWith('+') || line.startsWith('-')) &&
              !line.startsWith('+++') &&
              !line.startsWith('---'),
          )
          .map((line) => line.trim());

      const expectedLines = changedLines(expected);
      if (expectedLines.length === 0) return actual.trim() === '' ? 1 : 0;
      const actualLines = new Set(changedLines(actual));
      return expectedLines.filter((line) => actualLines.has(line)).length / expectedLines.length;
    })
    .generateReason(({ score }) =>
      score === 1
        ? 'diff matches the reference patch'
        : `diff covers ${Math.round(score * 100)}% of the reference patch lines`,
    );

  /** Scored: does the tree still pass the case's own verification commands? */
  const caseVerification = createScorer({
    id: 'case-verification',
    description: "The case's own verify commands pass against the final tree.",
  }).generateScore(async () => binary((await evidence()).caseVerificationPassed));

  return {
    gates: [cleanTree, pushDiscipline, closeDiscipline, verificationHonesty, authorFeedback],
    workflow: [patchAccuracy, caseVerification],
    steps: { triage: [triageAccuracy] },
  };
}
