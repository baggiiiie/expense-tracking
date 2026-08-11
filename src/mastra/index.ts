import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';

import { coderAgent, triageAgent } from './agents/issue-agents.ts';
import { resolveIssueWorkflow } from './workflows/resolve-issue.ts';

export const mastra = new Mastra({
  agents: { triageAgent, coderAgent },
  workflows: { resolveIssueWorkflow },
  // Resolver runs and eval scores only need to live for this process.
  storage: new InMemoryStore(),
});
