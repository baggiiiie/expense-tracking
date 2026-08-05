'use agent';

import { createProvider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import {
  setProvider,
  useAgentStart,
  useDataWriter,
  useInitialData,
  useModel,
  useSandbox,
} from '@flue/runtime';
import { local } from '@flue/runtime/node';

import {
  createProdGithub,
  type Github,
  type Payload,
  PayloadSchema,
  resolveIssue,
  Result,
} from '../workflows/resolve-issue.ts';

const gatewayModel = anthropicProvider()
  .getModels()
  .find((model) => model.id === 'claude-opus-4-8');

if (!gatewayModel) throw new Error('Claude Opus 4.8 is missing from the Anthropic catalog');

// `flue run` loads the agent module but not app.ts, so the custom provider is
// registered alongside the agent that uses it.
setProvider(
  createProvider({
    id: 'bedrock-mantle',
    auth: {
      apiKey: {
        name: 'Bedrock Mantle key',
        resolve: async () => ({ auth: { apiKey: process.env.ANTHROPIC_API_KEY } }),
      },
    },
    models: [
      {
        ...gatewayModel,
        id: 'anthropic.claude-opus-4-8',
        provider: 'bedrock-mantle',
        baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/anthropic',
      },
    ],
    api: anthropicMessagesApi(),
  }),
);

/**
 * A CI coding agent whose start hook runs the deterministic issue-resolution
 * pipeline. Application code owns GitHub writes, verification, commits,
 * pushes, and visual proof; harness prompts only perform judgment work.
 */
export function useIssueResolver(
  github: (harness: Parameters<typeof createProdGithub>[0]) => Github,
  sandbox = local({ env: { GH_TOKEN: process.env.GH_TOKEN } }),
) {
  const payload = useInitialData<Payload>();
  const writeResult = useDataWriter('result', { schema: Result });

  useModel('bedrock-mantle/anthropic.claude-opus-4-8', { thinkingLevel: 'high' });
  useSandbox(sandbox);
  useAgentStart(async ({ append, harness }) => {
    const result = await resolveIssue(harness, payload, github(harness));
    writeResult(result);
    append({
      kind: 'signal',
      type: 'resolve_issue.completed',
      body: JSON.stringify(result),
    });
  });

  return (
    'You are a precise software engineer for this repository. Follow each prompt’s ' +
    'requested task and make the smallest correct change. Never run git, gh, push, ' +
    'commit, or close an issue; deterministic application code owns those operations. ' +
    'When a resolve_issue.completed signal is present, briefly report its outcome and stop.'
  );
}

export function IssueResolver() {
  return useIssueResolver(createProdGithub);
}

IssueResolver.agentName = 'issue-resolver';
IssueResolver.initialData = PayloadSchema;
IssueResolver.durability = { maxAttempts: 3, timeoutMs: 30 * 60 * 1000 };
