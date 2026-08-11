import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['evals/**/*.eval.ts'],
    // A single case runs a coding agent and two full builds.
    testTimeout: 45 * 60 * 1000,
    hookTimeout: 45 * 60 * 1000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
