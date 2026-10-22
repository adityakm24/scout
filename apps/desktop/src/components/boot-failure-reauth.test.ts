import { describe, expect, it } from 'vitest'

import {
  isGatewayHandshakeError,
  isRemoteReauthError,
  shouldApplyPostBootProgressError
} from './boot-failure-reauth'

describe('isRemoteReauthError', () => {
  it('recognizes auth-shaped boot errors', () => {
    expect(isRemoteReauthError('Your remote gateway session has expired.')).toBe(true)
    expect(isRemoteReauthError('OAuth: please sign in')).toBe(true)
    expect(isRemoteReauthError('Reached the gateway over HTTP, but the app token is invalid.')).toBe(true)
  })

  it('ignores non-auth boot errors and nullish', () => {
    expect(isRemoteReauthError('Scout background process exited during startup.')).toBe(false)
    expect(isRemoteReauthError(null)).toBe(false)
  })
})

describe('isGatewayHandshakeError', () => {
  it('recognizes a socket that failed before it opened', () => {
    expect(
      isGatewayHandshakeError('Could not connect to Scout gateway (WebSocket error before open)')
    ).toBe(true)
    expect(isGatewayHandshakeError('Could not connect to Scout gateway (no WebSocket open within 15000 ms)')).toBe(
      true
    )
    expect(
      isGatewayHandshakeError('Could not connect to Scout gateway (WebSocket closed during handshake: code 4401)')
    ).toBe(true)
  })

  it('ignores other boot errors', () => {
    expect(isGatewayHandshakeError('Scout background process exited during startup.')).toBe(false)
    expect(isGatewayHandshakeError('Your remote gateway session has expired.')).toBe(false)
    expect(isGatewayHandshakeError(null)).toBe(false)
  })
})

describe('shouldApplyPostBootProgressError', () => {
  it('applies only confirmed reauth after a healthy boot — not transient ticket blips', () => {
    expect(shouldApplyPostBootProgressError('Your remote gateway session has expired.')).toBe(true)
    expect(
      shouldApplyPostBootProgressError(
        'Could not reach the remote Scout gateway while refreshing its WebSocket ticket. Try reconnecting.'
      )
    ).toBe(false)
    expect(shouldApplyPostBootProgressError('Lost connection to the gateway')).toBe(false)
    expect(shouldApplyPostBootProgressError(null)).toBe(false)
  })
})
