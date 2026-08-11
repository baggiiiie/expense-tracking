import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import * as v from 'valibot';

/**
 * Framework-neutral contract shared by the Flue and Mastra issue resolvers.
 *
 * Both stacks are kept side by side to compare orchestration and evaluation, so
 * the pieces that define *what* is being measured live here rather than being
 * duplicated per stack. Duplicated categories or fixtures would drift and
 * silently invalidate any comparison between the two.
 */
const TRIAGE_CATEGORIES = ['bug', 'feature', 'invalid', 'duplicate', 'stale', 'unclear'] as const;

export const TriageCategory = v.picklist(TRIAGE_CATEGORIES);

export type TriageCategoryType = v.InferOutput<typeof TriageCategory>;

/** Categories the resolver will attempt to fix. */
export const FIXABLE_CATEGORIES: readonly TriageCategoryType[] = ['bug', 'feature'];

/** Categories terminal enough to close without human review. */
export const CLOSABLE_CATEGORIES: readonly TriageCategoryType[] = ['invalid', 'duplicate', 'stale'];

const casesRoot = path.resolve(import.meta.dirname, '../../evals/cases');

const CaseSchema = v.object({
  repository: v.object({
    url: v.string(),
    revision: v.string(),
    defaultBranch: v.string(),
  }),
  issue: v.object({
    number: v.number(),
    title: v.string(),
    body: v.string(),
    labels: v.optional(v.array(v.string()), []),
  }),
  expectedPatch: v.string(),
  verify: v.array(v.string()),
  expected: v.object({
    triage: TriageCategory,
    shouldPush: v.boolean(),
    shouldClose: v.boolean(),
  }),
});

export type EvalCase = v.InferOutput<typeof CaseSchema>;

export async function loadCase(name: string): Promise<{ directory: string; value: EvalCase }> {
  const directory = path.join(casesRoot, name);
  const source = await readFile(path.join(directory, 'case.json'), 'utf8');
  return { directory, value: v.parse(CaseSchema, JSON.parse(source)) };
}

export async function listCases(): Promise<string[]> {
  return (await readdir(casesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Drop diff noise that varies between runs (hunk headers, blob indexes, and
 * context lines) so two patches can be compared for equivalent intent.
 */
export function normalizePatch(patch: string): string {
  return `${patch
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => !line.startsWith('index ') && !line.startsWith('@@') && !line.startsWith(' '))
    .join('\n')
    .trimEnd()}\n`;
}
