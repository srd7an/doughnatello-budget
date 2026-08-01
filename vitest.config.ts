import { defineConfig } from 'vitest/config'

// Convex functions run in an edge-like runtime; convex-test needs it inlined.
// https://docs.convex.dev/testing/convex-test
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
    // Convex functions plus the pure frontend helpers (money/CSV formatting),
    // which are exactly the code where a silent rounding bug would hide.
    include: ['convex/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
