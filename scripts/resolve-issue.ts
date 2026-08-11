import { resolveIssue } from '../src/mastra/resolve.ts';

/**
 * CLI entrypoint: `npm run resolve-issue -- --issue <n>`.
 *
 * Node runs the TypeScript sources directly, so there is nothing to spawn — the
 * workflow is called in-process and the result is printed as JSON for CI logs.
 */
const args = process.argv.slice(2);
const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const issueText = valueAfter('--issue') ?? process.env.ISSUE_NUMBER;
if (!issueText || !/^[1-9]\d*$/.test(issueText)) {
  console.error('usage: npm run resolve-issue -- --issue <positive integer>');
  process.exit(2);
}
if (process.env.CI !== 'true' && process.env.RESOLVER_DISPOSABLE !== '1') {
  console.error(
    'The coding agent may run repository code and must use a disposable runner. ' +
      'Set RESOLVER_DISPOSABLE=1 only inside a throwaway VM or container.',
  );
  process.exit(2);
}

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => controller.abort());
}

try {
  const result = await resolveIssue({ issueNumber: Number(issueText) }, { signal: controller.signal });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
