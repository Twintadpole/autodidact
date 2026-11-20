import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@pool/source'] },
  test: { include: ['src/**/*.test.ts'] },
});
