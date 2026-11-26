import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    env: {
      DATABASE_URL: 'postgres://unused-in-tests',
      JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-bytes',
      // A Redis database of the tests' own: they empty it.
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
      // February 29th, 3 AM: the tests run the digest themselves.
      DIGEST_CRON: '0 3 29 2 *',
    },
  },
});
