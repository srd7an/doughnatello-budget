import { afterEach, vi } from 'vitest'

/**
 * One setup file, two worlds.
 *
 * Vitest runs this for EVERY test, and the Convex ones live in an edge-like
 * runtime with no document, no HTMLInputElement and nothing to clean up. So
 * the DOM half is loaded only when there is a DOM to load it into — a static
 * import of jest-dom at the top would take the backend suite down with it.
 */

let desktop = false

/** Which width the shell should think it is on. Real matchMedia, real
 *  decision — the component is not stubbed, only the viewport is. */
export function setViewport(size: 'phone' | 'desktop') {
  desktop = size === 'desktop'
}

if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  const { cleanup } = await import('@testing-library/react')
  afterEach(() => {
    cleanup()
    setViewport('phone')
  })

  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: desktop,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )

  // The date field calls it; jsdom does not implement it.
  if (!HTMLInputElement.prototype.showPicker) {
    HTMLInputElement.prototype.showPicker = () => {}
  }
}
