import { describe, expect, it } from 'vitest'

import { isRemoteReauthError, shouldApplyPostBootProgressError } from './boot-failure-reauth'

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
