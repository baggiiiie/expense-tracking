import { registerProvider } from '@flue/runtime';
import { flue } from '@flue/runtime/routing';
import { Hono } from 'hono';

/**
 * Provider: bedrock-mantle
 *
 * Mirrors the `bedrock-mantle` provider from your Pi config
 * (~/.pi/agent/models.json): a custom gateway that speaks the Anthropic
 * Messages wire protocol and authenticates with ANTHROPIC_API_KEY. The model
 * specifier used throughout this project is
 * `bedrock-mantle/anthropic.claude-opus-4-8`.
 *
 * Set ANTHROPIC_API_KEY in the environment (it is loaded from .env locally and
 * from a repository secret in CI). No secret is committed here.
 */
registerProvider('bedrock-mantle', {
  api: 'anthropic-messages',
  baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
  contextWindow: 1_000_000,
  maxTokens: 128_000,
});

// Routing entry. The resolve-issue workflow is invoked via `flue run` and does
// not need a public HTTP route, but app.ts must default-export the app.
const app = new Hono();
app.route('/', flue());

export default app;
