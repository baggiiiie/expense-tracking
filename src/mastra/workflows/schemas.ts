import { toStandardJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';

import { FIXABLE_CATEGORIES, TriageCategory } from '../../shared/issue-resolution.ts';

/**
 * The resolve-issue contract: what a caller passes in, and what a run reports.
 *
 * Mastra accepts any Standard JSON Schema, so the valibot schemas already shared
 * with the Flue resolver are reused directly via `toStandardJsonSchema` instead
 * of being re-declared in Zod. `standard()` wraps a valibot schema for the
 * places Mastra wants the JSON Schema form (step and workflow schemas).
 *
 * Schemas that only carry data between steps live in `resolve-issue.ts`; this
 * file is the part evals and callers are allowed to depend on.
 */
export const standard = toStandardJsonSchema;

export const PayloadSchema = v.object({
  issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

export type Payload = v.InferOutput<typeof PayloadSchema>;

/** Triage judgment. For categories the workflow won't fix, `reason` is posted to the author. */
export const Triage = v.object({
  valid: v.boolean(),
  category: TriageCategory,
  reason: v.string(),
});

export type TriageType = v.InferOutput<typeof Triage>;

/** Whether the workflow will try to write code for this judgment. */
export function isFixable(triage: TriageType): boolean {
  return triage.valid && FIXABLE_CATEGORIES.includes(triage.category);
}

/**
 * The result of running `npm run verify` in the checkout. Produced by code, not
 * by the model, so `details` is real command output.
 */
export const Verification = v.object({
  ran: v.boolean(),
  passed: v.boolean(),
  details: v.string(),
});

export const Result = v.object({
  issue: v.number(),
  /** Null when the run ended before triage, so a real judgment is never faked. */
  triage: v.nullable(Triage),
  fix: v.object({
    attempted: v.boolean(),
    applied: v.boolean(),
    commitSha: v.optional(v.string()),
    summary: v.optional(v.string()),
  }),
  verification: Verification,
  closed: v.boolean(),
});

export type ResultType = v.InferOutput<typeof Result>;
