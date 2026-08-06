import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertCleanWorkspace, buildCommitMessage, parsePorcelainV1Z } from '../workflows/resolve-issue.ts';
import { createProdGithub } from '../workflows/github.ts';

describe('buildCommitMessage', () => {
  it('references the issue without using a GitHub auto-close keyword', () => {
    const message = buildCommitMessage(20, 'Show weekdays next to dates');

    assert.equal(message, 'Address issue #20: Show weekdays next to dates\n');
    assert.doesNotMatch(message, /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#20\b/i);
  });
});

describe('parsePorcelainV1Z', () => {
  it('returns both sides of renames and preserves unusual paths', () => {
    const output =
      'R  server/new name.go\0docs/old -> name.md\0' + '?? docs/untracked file.md\0' + ' M server/web/src/page.ts\0';

    assert.deepEqual(parsePorcelainV1Z(output), [
      'server/new name.go',
      'docs/old -> name.md',
      'docs/untracked file.md',
      'server/web/src/page.ts',
    ]);
  });

  it('rejects incomplete rename records', () => {
    assert.throws(() => parsePorcelainV1Z('R  new.ts\0'), /incomplete git rename record/);
  });
});

describe('workspace preflight', () => {
  it('refuses a dirty checkout without changing it', async () => {
    const exec = async () => ({
      exitCode: 0,
      stdout: ' M existing.txt\0?? untracked.txt\0',
      stderr: '',
    });
    const harness = { sandbox: { exec } };

    await assert.rejects(
      assertCleanWorkspace(harness as never),
      /requires a clean disposable checkout.*existing\.txt.*untracked\.txt/,
    );
  });
});

describe('production GitHub adapter', () => {
  const failingHarness = (stderr: string) => ({
    sandbox: {
      exec: async () => ({ exitCode: 1, stdout: '', stderr }),
      writeFile: async () => {},
    },
  });

  it('does not guess a default branch when gh fails', async () => {
    const github = createProdGithub(failingHarness('API unavailable') as never);
    await assert.rejects(github.getDefaultBranch(), /default-branch lookup failed: API unavailable/);
  });

  it('propagates comment and close failures', async () => {
    const github = createProdGithub(failingHarness('permission denied') as never);
    await assert.rejects(github.comment(42, 'body'), /issue comment failed: permission denied/);
    await assert.rejects(github.close(42, 'completed'), /issue close failed: permission denied/);
  });
});
