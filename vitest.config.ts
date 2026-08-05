import { defineConfig } from 'vitest/config'

/**
 * Two kinds of test in one run, because they need two different worlds.
 *
 * Convex functions run in an edge-like runtime; convex-test needs it inlined.
 * https://docs.convex.dev/testing/convex-test
 *
 * Screens need a DOM. They are `.test.tsx`, and that suffix is what routes them
 * to jsdom — no per-file pragma to forget.
 *
 * Expressed as two PROJECTS rather than as one environment with a list of
 * exceptions. `environmentMatchGlobs` did the latter and was removed in Vitest
 * 3; the failure it leaves behind is worth recognising, because it does not
 * mention configuration at all — every DOM test dies on `document` being
 * undefined, as though the library were broken.
 *
 * No @vitejs/plugin-react here. Vitest bundles its own Vite, so a plugin built
 * against the project's Vite is a different `Plugin` type and `tsc -b` refuses
 * the config. It is not needed either: esbuild transforms JSX from the
 * tsconfig's `jsx: react-jsx`, and fast refresh means nothing in a test run.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'edge-runtime',
          setupFiles: ['./src/test/setup.ts'],
          server: { deps: { inline: ['convex-test'] } },
          // Convex functions, and the pure frontend helpers — money and CSV
          // formatting — where a silent rounding bug would hide.
          include: ['convex/**/*.test.ts', 'src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'screens',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.tsx'],
        },
      },
    ],
  },
})
