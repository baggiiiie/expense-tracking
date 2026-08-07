import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setupEnv } from '../workflows/resolve-issue.ts';
import { createProdGithub } from '../workflows/github.ts';

describe('workspace preflight', () => {
  it('refuses a dirty checkout without changing it', async () => {
    const exec = async () => ({
      exitCode: 0,
      stdout: ' M existing.txt\n?? untracked.txt\n',
      stderr: '',
    });
    const harness = { sandbox: { exec } };

    await assert.rejects(
      setupEnv(harness as never),
      /requires a clean disposable checkout[\s\S]*existing\.txt[\s\S]*untracked\.txt/,
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
