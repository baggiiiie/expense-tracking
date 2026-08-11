import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';

import { coderAgent, triageAgent } from './agents/issue-agents.ts';
import { resolveIssueWorkflow } from './workflows/resolve-issue.ts';

/**
 * Storage is what makes a run inspectable: snapshots for `restart()` after a
 * lost connection, and the traces `runEvals` reads to build a real trajectory
 * (without it, trajectory scoring falls back to bare step results). A single
 * resolve-issue run is one process that either finishes or is retried by CI, so
 * an in-memory store is enough and keeps the dependency footprint at zero.
 */
export const mastra = new Mastra({
  agents: { triageAgent, coderAgent },
  workflows: { resolveIssueWorkflow },
  storage: new InMemoryStore(),
});
