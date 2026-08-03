import { defineConfig } from 'vitest/config'

/**
 * Two kinds of test in one run, because they need two different worlds.
 *
 * Convex functions run in an edge-like runtime; convex-test needs it inlined.
 * https://docs.convex.dev/testing/convex-test
 *
 * Screens need a DOM. They are `.test.tsx`, and that suffix is what routes
 * them to jsdom — no per-file pragma to forget.
 *
 * No @vitejs/plugin-react here. Vitest 2 bundles its own Vite, so a plugin
 * built against the project's Vite 6 is a different `Plugin` type and `tsc -b`
 * refuses the config. It is not needed either: esbuild transforms JSX from the
 * tsconfig's `jsx: react-jsx`, and fast refresh means nothing in a test run.
 */
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    setupFiles: ['./src/test/setup.ts'],
    server: { deps: { inline: ['convex-test'] } },
    // Convex functions, the pure frontend helpers (money/CSV formatting) where
    // a silent rounding bug would hide, and the screens themselves.
    include: ['convex/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
