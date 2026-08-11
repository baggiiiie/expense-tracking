import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { EvalCase } from '../src/shared/issue-resolution.ts';
import { commandError, createShell, type Shell } from '../src/mastra/integrations/shell.ts';

/**
 * A disposable clone of the repository at the case's revision.
 *
 * `LocalSandbox` selects a working directory but is not filesystem containment,
 * so model-backed evals must only run on a throwaway runner or container. The
 * fixture reduces blast radius: an isolated HOME, no global git config, and an
 * `origin` pointing at a local bare repo so even a model-initiated push cannot
 * escape the temporary directory.
 */
export type RepositoryFixture = {
  root: string;
  workspace: string;
  env: NodeJS.ProcessEnv;
  initialSha: string;
  shell: Shell;
};

export async function createRepository(name: string, testCase: EvalCase): Promise<RepositoryFixture> {
  const root = await mkdtemp(path.join(tmpdir(), `mastra-eval-${name}-`));
  const workspace = path.join(root, 'workspace');
  const home = path.join(root, 'home');
  await mkdir(home);

  const env: NodeJS.ProcessEnv = {
    HOME: home,
    LANG: process.env.LANG ?? 'C.UTF-8',
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };

  const at = (cwd: string): Shell => createShell({ cwd, env });
  const rootShell = at(root);
  const run = async (shell: Shell, command: string, description: string) => {
    const result = await shell(command, { timeoutMs: 10 * 60 * 1000 });
    if (result.exitCode !== 0) throw new Error(`${description} failed: ${commandError(result)}`);
    return result.stdout.trim();
  };

  await run(
    rootShell,
    `git clone --quiet --no-checkout ${testCase.repository.url} ${JSON.stringify(workspace)}`,
    'git clone',
  );
  const shell = at(workspace);
  await run(shell, `git checkout --quiet --detach ${testCase.repository.revision}`, 'git checkout');
  await run(shell, `git config user.name "expense-eval" && git config user.email "expense-eval@invalid"`, 'git config');
  const initialSha = await run(shell, 'git rev-parse HEAD', 'git rev-parse');

  const bareRemote = path.join(root, 'origin.git');
  await run(rootShell, `git init --quiet --bare ${JSON.stringify(bareRemote)}`, 'git init bare');
  await run(shell, `git remote set-url origin ${JSON.stringify(bareRemote)}`, 'git remote set-url');

  return { root, workspace, env, initialSha, shell };
}

export async function cleanupRepository(repository: RepositoryFixture): Promise<void> {
  await rm(repository.root, { recursive: true, force: true });
}
