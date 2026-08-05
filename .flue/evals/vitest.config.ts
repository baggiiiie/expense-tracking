import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['.flue/evals/**/*.eval.ts'],
    testTimeout: 45 * 60 * 1000,
    hookTimeout: 45 * 60 * 1000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
