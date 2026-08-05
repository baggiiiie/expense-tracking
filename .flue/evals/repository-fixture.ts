import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { EvalCase } from './eval-case.ts';

// local() selects a working directory but is not filesystem containment. Run
// model-backed evals only in an ephemeral CI job, orb, container, or VM.
const exec = promisify(execFile);

type CommandResult = { stdout: string; stderr: string };

export type RepositoryFixture = {
  root: string;
  workspace: string;
  isolatedHome: string;
  env: NodeJS.ProcessEnv;
  initialSha: string;
};

export async function command(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  return exec(executable, args, {
    cwd: options.cwd,
    env: options.env,
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
  });
}

export async function git(repository: RepositoryFixture, ...args: string[]): Promise<string> {
  return (
    await command('git', ['-C', repository.workspace, ...args], { env: repository.env })
  ).stdout.trim();
}

export async function createRepository(name: string): Promise<RepositoryFixture> {
  const root = await mkdtemp(path.join(tmpdir(), `expense-eval-${name}-`));
  const repository: RepositoryFixture = {
    root,
    workspace: path.join(root, 'workspace'),
    isolatedHome: path.join(root, 'home'),
    env: {
      HOME: path.join(root, 'home'),
      LANG: process.env.LANG ?? 'C.UTF-8',
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
    initialSha: '',
  };
  await mkdir(repository.isolatedHome);
  return repository;
}

export async function checkoutRepository(
  repository: RepositoryFixture,
  testCase: EvalCase,
): Promise<void> {
  await command(
    'git',
    ['clone', '--quiet', '--no-checkout', testCase.repository.url, repository.workspace],
    { env: repository.env },
  );
  await git(repository, 'checkout', '--quiet', '--detach', testCase.repository.revision);
  await git(repository, 'config', 'user.name', 'expense-eval');
  await git(repository, 'config', 'user.email', 'expense-eval@invalid');
  repository.initialSha = await git(repository, 'rev-parse', 'HEAD');

  // Even a model-initiated push can only reach this disposable local remote.
  const bareRemote = path.join(repository.root, 'origin.git');
  await command('git', ['init', '--quiet', '--bare', bareRemote], { env: repository.env });
  await git(repository, 'remote', 'set-url', 'origin', bareRemote);
}

export async function cleanupRepository(repository: RepositoryFixture): Promise<void> {
  await rm(repository.root, { recursive: true, force: true });
}
