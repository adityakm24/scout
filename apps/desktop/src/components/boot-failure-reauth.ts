// Pure helpers for classifying boot errors, kept out of the .tsx so they can be
// unit-tested without a React render.

// True when a boot error is auth-shaped: the backend rejected the session or
// couldn't mint a websocket ticket. Retrying quietly can't fix that.
export function isRemoteReauthError(error: string | null | undefined): boolean {
  const text = String(error || '').toLowerCase()

  return (
    text.includes('remote gateway session has expired') ||
    text.includes('gateway sign-in required') ||
    text.includes('needs oauth login') ||
    text.includes('app token is invalid') ||
    (text.includes('oauth') && (text.includes('not signed in') || text.includes('sign in')))
  )
}

// The socket never opened: HTTP can still look healthy (public /api/status), so
// quiet recovery's reload loop just flickers Connecting ↔ this error.
export function isGatewayHandshakeError(error: string | null | undefined): boolean {
  const text = String(error || '').toLowerCase()

  return (
    text.includes('websocket error before open') ||
    text.includes('no websocket open within') ||
    text.includes('websocket closed during handshake')
  )
}

/**
 * After a healthy cold boot, main may still re-emit boot-progress errors when a
 * post-boot startScout()/ticket mint fails (liveness reset → rebuild, wake
 * recovery, etc.). Only CONFIRMED reauth should take over the full-screen
 * recovery overlay then — transient "could not reach … WebSocket ticket"
 * blips must stay in the reconnect loop so reading/drafting is not locked out
 * for 1–3 minutes while the socket self-heals.
 */
export function shouldApplyPostBootProgressError(error: string | null | undefined): boolean {
  return isRemoteReauthError(error)
}
