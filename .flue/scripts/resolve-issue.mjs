import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const issueText = valueAfter("--issue") ?? process.env.ISSUE_NUMBER;
if (!issueText || !/^[1-9]\d*$/.test(issueText)) {
  console.error("usage: npm run resolve-issue -- --issue <positive integer>");
  process.exit(2);
}
const issueNumber = Number(issueText);
const runId = process.env.GITHUB_RUN_ID ?? `manual-${Date.now()}`;
const flue = new URL("../../node_modules/.bin/flue", import.meta.url).pathname;
const child = spawn(
  flue,
  [
    "run",
    ".flue/agents/issue-resolver.ts",
    "--message",
    `Resolve issue #${issueNumber}.`,
    "--data",
    JSON.stringify({ issueNumber }),
    "--id",
    `resolve-issue-${issueNumber}-${runId}`,
    "--new",
    "--json",
  ],
  {
    cwd: new URL("../..", import.meta.url),
    stdio: "inherit",
    env: process.env,
  },
);
for (const name of ["SIGINT", "SIGTERM"]) {
  process.on(name, () => child.kill(name));
}
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
