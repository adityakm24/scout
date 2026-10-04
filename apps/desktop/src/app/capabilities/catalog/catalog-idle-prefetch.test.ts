import { afterEach, describe, expect, it, vi } from 'vitest'

import { prefetchCatalogWhenIdle } from './catalog-data'

// Safari/WebKit (the phone app's web view) has no requestIdleCallback; opening a page that warms
// a catalog crashed the whole workspace there ("Can't find variable: requestIdleCallback").
describe('catalog idle prefetch', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('works, and cancels, where the browser has no requestIdleCallback', () => {
    vi.useFakeTimers()
    // vitest.setup.ts stubs one in for jsdom; take it away, as WebKit does.
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.stubGlobal('cancelIdleCallback', undefined)

    const cancel = prefetchCatalogWhenIdle('plugins')

    expect(() => cancel()).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })
})
