import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom has no layout engine; stub the geometry APIs components call.
Element.prototype.scrollIntoView = vi.fn()
globalThis.ResizeObserver ??= class {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

afterEach(() => cleanup())
