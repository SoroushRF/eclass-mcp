import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      ECLASS_MCP_LOG_LEVEL: 'silent',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: {
        statements: 50,
        branches: 65,
        functions: 50,
        lines: 50,
      },
    },
  },
});
