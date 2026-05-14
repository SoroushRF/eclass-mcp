import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 15000,
    env: {
      ECLASS_MCP_LOG_LEVEL: 'silent',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      exclude: [
        'coverage/**',
        'dist/**',
        'tests/**',
        '*.config.ts',
        'src/auth/server.ts',
        'src/parser/pdf-analyzer.ts',
        'src/scraper/cengage.ts',
        'src/scraper/eclass/announcements.ts',
        'src/scraper/sis.ts',
      ],
      thresholds: {
        statements: 50,
        branches: 70,
        functions: 50,
        lines: 50,
      },
    },
  },
});
