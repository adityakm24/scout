import { capabilityScoped, type ProfileScope } from '@/api/client'
import {
  cancelGoogleSignIn,
  type GoogleSignInResult,
  pollGoogleSignIn,
  relayGoogleSignIn,
  startGoogleSignIn
} from '@/api/google-workspace'

const SIGN_IN_TIMEOUT_MS = 300_000

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Google sign-in for the Workspace card. The browser's redirect has to land on THIS machine: the
 * desktop's own loopback listener catches it and relays code + state to the backend (any
 * topology). Without that bridge only a local backend can catch it itself, so it is polled.
 * `signal` cancels the attempt (the card's Cancel).
 */
export async function signInWithGoogle(profile: ProfileScope | undefined, signal: AbortSignal): Promise<void> {
  const bridge = window.scoutDesktop.mcpOauth

  if (!bridge && capabilityScoped(profile).connectionId !== 'local') {
    throw new Error('Update Scout Desktop to sign in to Google on a remote backend.')
  }

  const listener = bridge ? await bridge.listen() : undefined
  let flowId: string | undefined
  let settled: GoogleSignInResult | undefined

  const onAbort = () => void (listener && bridge?.cancel(listener.id))
  signal.addEventListener('abort', onAbort)

  try {
    const started = await startGoogleSignIn(profile, listener?.redirectUri)
    flowId = started.flow_id
    signal.throwIfAborted()
    await window.scoutDesktop.openExternal(started.auth_url)

    if (listener && bridge) {
      const reply = await bridge.wait(listener.id, SIGN_IN_TIMEOUT_MS)
      signal.throwIfAborted()
      settled = await relayGoogleSignIn(profile, flowId, reply)
    } else {
      const deadline = Date.now() + SIGN_IN_TIMEOUT_MS

      while (Date.now() < deadline) {
        signal.throwIfAborted()
        settled = await pollGoogleSignIn(profile, flowId)

        if (settled.status !== 'pending') {
          break
        }

        await pause(1_500)
      }
    }

    if (settled?.status !== 'done') {
      throw new Error(settled?.error || 'Google sign-in did not finish.')
    }
  } finally {
    signal.removeEventListener('abort', onAbort)

    if (flowId && settled?.status !== 'done') {
      void cancelGoogleSignIn(profile, flowId).catch(() => {})
    }
  }
}
