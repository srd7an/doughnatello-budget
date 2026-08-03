import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Two kinds of test in one run, because they need two different worlds.
 *
 * Convex functions run in an edge-like runtime; convex-test needs it inlined.
 * https://docs.convex.dev/testing/convex-test
 *
 * Screens need a DOM. They are `.test.tsx`, and that suffix is what routes
 * them to jsdom — no per-file pragma to forget.
 */
export default defineConfig({
  plugins: [react()],
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
