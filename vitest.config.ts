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
      // ifaces.ts is type-only (erased at compile) — nothing executable to cover.
      exclude: ['src/main/ts/ifaces.ts'],
      // Enforce the 95+ line/statement/function bar; branch is harder (raw HTTP /
      // signal edges), floored well below the current 82%.
      thresholds: { statements: 95, lines: 95, functions: 95, branches: 80 },
    },
  },
})
