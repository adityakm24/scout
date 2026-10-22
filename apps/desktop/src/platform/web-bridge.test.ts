import { describe, expect, it } from 'vitest'

import { pickRemoteSessionToken } from './web-bridge'

describe('pickRemoteSessionToken', () => {
  it('prefers the token this backend served over a stale native pairing token', () => {
    expect(
      pickRemoteSessionToken({
        link: 'from-qr',
        native: 'stale-pairing',
        served: 'live-backend',
        stored: 'old-local'
      })
    ).toBe('live-backend')
  })

  it('falls back through native, QR, then stored when the page did not inject a token', () => {
    expect(pickRemoteSessionToken({ native: 'pairing', stored: 'old' })).toBe('pairing')
    expect(pickRemoteSessionToken({ link: 'from-qr', stored: 'old' })).toBe('from-qr')
    expect(pickRemoteSessionToken({ stored: 'old' })).toBe('old')
    expect(pickRemoteSessionToken({})).toBe('')
  })
})
