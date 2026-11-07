import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@pool/source'] },
  ssr: { resolve: { conditions: ['@pool/source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Test files share one Mongo server but use separate databases.
    fileParallelism: false,
  },
});
