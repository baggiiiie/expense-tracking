import { createAnthropic } from '@ai-sdk/anthropic';

/**
 * The bedrock-mantle gateway speaks the Anthropic Messages protocol rather than
 * an OpenAI-compatible one, so Mastra's `model: { id, url }` shorthand (which
 * assumes OpenAI compatibility) can't reach it. Going through the AI SDK's
 * Anthropic provider keeps the protocol correct; Mastra accepts an AI SDK model
 * instance anywhere a "provider/model" string is allowed.
 */
const DEFAULT_BASE_URL = 'https://bedrock-mantle.us-east-1.api.aws/anthropic/v1';

const MODEL_ID = 'anthropic.claude-opus-4-8';

function requireApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required to reach the bedrock-mantle gateway');
  return apiKey;
}

const anthropic = createAnthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL ?? DEFAULT_BASE_URL,
  get apiKey() {
    return requireApiKey();
  },
});

export const model = anthropic(MODEL_ID);
