import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import * as v from 'valibot';

const casesRoot = path.resolve(import.meta.dirname, 'cases');

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
    triage: v.picklist(['bug', 'feature', 'invalid', 'duplicate', 'stale', 'unclear']),
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
