import { defineConfig } from 'vitest/config';

/** @type {import('vite').UserConfig} */
export default defineConfig({
  test: {
    include: ['test/**/*.ts', 'test/**/*.cjs'],
    testTimeout: 60_000,
    globals: true,
    coverage: {
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage'
    }
  }
});
