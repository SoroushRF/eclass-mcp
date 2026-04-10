import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: {
        statements: 30,
        branches: 30,
        functions: 25,
        lines: 30,
      },
    },
  },
});
