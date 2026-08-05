import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { init } from '@flue/runtime';
import { local, start } from '@flue/runtime/node';
import * as v from 'valibot';

import { useIssueResolver } from '../agents/issue-resolver.ts';
import {
  type GitHubIssue,
  PayloadSchema,
  Result,
  type ResultType,
} from '../workflows/resolve-issue.ts';
import { createEvalGithub, type EvalAction } from './eval-github.ts';
import { loadCase } from './eval-case.ts';
import {
  checkoutRepository,
  cleanupRepository,
  command,
  createRepository,
  git,
} from './repository-fixture.ts';

function normalizePatch(patch: string): string {
  return `${patch
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith('index ') && !line.startsWith('@@') && !line.startsWith(' '),
    )
    .join('\n')
    .trimEnd()}\n`;
}

export async function runCase(name: string, keepWorkspace: boolean) {
  const { directory, value: testCase } = await loadCase(name);
  let repository;
  let succeeded = false;

  try {
    repository = await createRepository(name);
    await checkoutRepository(repository, testCase);
    const actions: EvalAction[] = [];
    const issue: GitHubIssue = {
      ...testCase.issue,
      labels: testCase.issue.labels.map((label) => ({ name: label })),
      comments: [],
      state: 'OPEN',
    };
    const github = createEvalGithub(issue, testCase.repository.defaultBranch, actions);

    function EvalIssueResolver() {
      return useIssueResolver(
        () => github,
        local({ cwd: repository!.workspace, env: repository!.env }),
      );
    }
    EvalIssueResolver.agentName = `issue-resolver-eval-${name}`;
    EvalIssueResolver.initialData = PayloadSchema;
    EvalIssueResolver.durability = { maxAttempts: 1, timeoutMs: 30 * 60 * 1000 };

    const result: ResultType = await (async () => {
      await using flue = await start({ agents: [EvalIssueResolver] });
      const agent = init(EvalIssueResolver, { id: `eval-${name}-${Date.now()}`, uid: null });
      const receipt = await agent.dispatch({
        message: `Resolve issue #${issue.number}.`,
        initialData: { issueNumber: issue.number, dryRun: false },
      });
      const reply = await agent.read(receipt);
      return v.parse(Result, reply.data.result?.at(-1));
    })();

    const diff = await git(repository, 'diff', '--no-ext-diff', '--binary', repository.initialSha);
    const status = await git(repository, 'status', '--porcelain=v1', '--untracked-files=all');
    const verification = [];
    for (const verifyCommand of testCase.verify) {
      try {
        const checked = await command('/bin/bash', ['-c', verifyCommand], {
          cwd: repository.workspace,
          env: repository.env,
        });
        verification.push({ command: verifyCommand, passed: true, output: checked.stdout.trim() });
      } catch (error) {
        const failed = error as Error & { stdout?: string; stderr?: string };
        verification.push({
          command: verifyCommand,
          passed: false,
          output: (failed.stderr || failed.stdout || failed.message).trim(),
        });
      }
    }

    const pushes = actions.filter((action) => action.type === 'push');
    const closes = actions.filter((action) => action.type === 'close');
    const pushMatches = testCase.expected.shouldPush
      ? pushes.length === 1 && pushes[0]?.branch === testCase.repository.defaultBranch
      : pushes.length === 0;
    const expectedCloseReason = testCase.expected.shouldPush ? 'completed' : 'not planned';
    const closeMatches = testCase.expected.shouldClose
      ? closes.length === 1 &&
        closes[0]?.number === issue.number &&
        closes[0]?.reason === expectedCloseReason
      : closes.length === 0;
    const expectedPatch = await readFile(path.join(directory, testCase.expectedPatch), 'utf8');
    const diffMatchesExpected = normalizePatch(diff) === normalizePatch(expectedPatch);
    const checks = {
      triage: result.triage.category === testCase.expected.triage,
      workflowVerification: result.verification.passed === testCase.expected.shouldPush,
      caseVerification: verification.every((check) => check.passed),
      workingTreeClean: status === '',
      push: pushMatches,
      close: closeMatches,
      expectedPatch: diffMatchesExpected,
    };
    succeeded = Object.values(checks).every(Boolean);

    return {
      case: name,
      passed: succeeded,
      workspace: keepWorkspace || !succeeded ? repository.workspace : undefined,
      initialSha: repository.initialSha,
      result,
      actions,
      diff,
      status,
      diffMatchesExpected,
      verification,
      checks,
    };
  } catch (error) {
    return {
      case: name,
      passed: false,
      workspace: repository?.workspace,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (repository && !keepWorkspace && succeeded) await cleanupRepository(repository);
  }
}
