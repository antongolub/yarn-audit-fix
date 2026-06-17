import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Real-world fixtures parse many sizeable lockfiles; lift the per-test
    // timeout above vitest's 5s default to stay comfortable on slow CI.
    testTimeout: 60_000,
    include: ['src/test/ts/**/*.ts'],
    exclude: ['**/node_modules/**', 'src/test/fixtures/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './target/coverage',
      include: ['src/main/**/*.ts'],
    },
  },
})
