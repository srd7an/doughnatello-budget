import { defineConfig } from 'vitest/config'

// Convex functions run in an edge-like runtime; convex-test needs it inlined.
// https://docs.convex.dev/testing/convex-test
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
    include: ['convex/**/*.test.ts'],
  },
})
