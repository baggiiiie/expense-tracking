/** Low-level shell helpers shared by the workflow and its integrations. */

export type ShellResult = { exitCode: number; stdout: string; stderr: string };

/** Single-quote a value for safe interpolation into a shell command. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** A short, human-readable tail of a failed command's output. */
export function commandError(result: ShellResult): string {
  return (result.stderr || result.stdout).slice(-500).trim() || `exit ${result.exitCode}`;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
