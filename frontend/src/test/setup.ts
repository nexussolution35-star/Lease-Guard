import '@testing-library/jest-dom/vitest'

// jsdom polyfills required by Radix UI primitives (Select, Popover, Dialog, Tooltip).
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }
  if (!('ResizeObserver' in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverStub })
    Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: ResizeObserverStub })
  }
  const elementProto = window.HTMLElement.prototype as HTMLElement & {
    hasPointerCapture?: (id: number) => boolean
    releasePointerCapture?: (id: number) => void
    setPointerCapture?: (id: number) => void
  }
  if (!elementProto.hasPointerCapture) elementProto.hasPointerCapture = () => false
  if (!elementProto.releasePointerCapture) elementProto.releasePointerCapture = () => {}
  if (!elementProto.setPointerCapture) elementProto.setPointerCapture = () => {}
  if (!elementProto.scrollIntoView) elementProto.scrollIntoView = () => {}
}
