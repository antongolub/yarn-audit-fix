import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Some lockfile patch tests resolve fixes via real `npm view` registry
    // lookups, which can exceed the default 5s timeout.
    testTimeout: 60_000,
    // commander is a dual CJS/ESM package; let Node load it natively instead
    // of vitest inlining it (which breaks its internal `new Command()`).
    server: {
      deps: {
        external: [/commander/],
      },
    },
    include: ['src/test/ts/**/*.ts'],
    exclude: ['**/node_modules/**', 'src/test/fixtures/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './target/coverage',
      include: ['src/main/**/*.ts'],
    },
  },
})
