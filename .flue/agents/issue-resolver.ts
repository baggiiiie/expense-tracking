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
  usePersistentState,
  useSandbox,
} from '@flue/runtime';
import { local } from '@flue/runtime/node';

import {
  type Payload,
  PayloadSchema,
  type ResolveDeps,
  resolveIssue,
  Result,
  type ResultType,
} from '../workflows/resolve-issue.ts';
import { createProdGithub } from '../workflows/github.ts';
import { createBrowserDemo } from '../workflows/web-demo.ts';

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
        resolve: async () => ({
          auth: { apiKey: process.env.ANTHROPIC_API_KEY },
        }),
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

export function useIssueResolver(
  makeDeps: (harness: Parameters<typeof createProdGithub>[0], signal?: AbortSignal) => ResolveDeps,
  sandbox = local({ cwd: process.cwd() }),
) {
  const payload = useInitialData<Payload>();
  const writeResult = useDataWriter('result', { schema: Result });
  const [completedResult, setCompletedResult] = usePersistentState<ResultType | null>('resolve-issue.result', null);

  useModel('bedrock-mantle/anthropic.claude-opus-4-8', {
    thinkingLevel: 'high',
  });
  useSandbox(sandbox);
  useAgentStart(async ({ append, harness, signal }) => {
    const result = completedResult ?? (await resolveIssue(harness, payload, makeDeps(harness, signal), signal));
    if (completedResult === null) setCompletedResult(result);
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
  return useIssueResolver((harness, signal) => ({
    github: createProdGithub(harness, signal),
    demo: createBrowserDemo(harness, signal),
  }));
}

IssueResolver.agentName = 'issue-resolver';
IssueResolver.initialData = PayloadSchema;
// The workflow performs external side effects. Do not automatically replay an
// interrupted attempt; application-level operations are made idempotent separately.
IssueResolver.durability = { maxAttempts: 1, timeoutMs: 30 * 60 * 1000 };
