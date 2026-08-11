import { spawn } from 'node:child_process';

export type ShellResult = { exitCode: number; stdout: string; stderr: string };

export type Shell = (command: string, options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number }) => Promise<ShellResult>;

/** Single-quote a value for safe interpolation into a shell command. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** A short, human-readable tail of a failed command's output. */
export function commandError(result: ShellResult): string {
  return (result.stderr || result.stdout).slice(-500).trim() || `exit ${result.exitCode}`;
}

/**
 * Run a command through bash, resolving with a non-zero exit code rather than
 * throwing. Callers decide which failures are fatal, which keeps best-effort
 * steps (media conversion, cleanup) from aborting the workflow.
 */
export function createShell(options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal }): Shell {
  return (command, callOptions) =>
    new Promise((resolve, reject) => {
      const child = spawn('/bin/bash', ['-c', command], {
        cwd: options.cwd,
        env: { ...options.env, ...callOptions?.env },
        signal: options.signal,
      });
      let stdout = '';
      let stderr = '';
      const timeoutMs = callOptions?.timeoutMs;
      const timer = timeoutMs
        ? setTimeout(() => {
            child.kill('SIGKILL');
            stderr += `\ncommand exceeded ${timeoutMs}ms and was killed`;
          }, timeoutMs)
        : undefined;

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
}
