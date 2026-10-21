import { capabilityScoped, type ProfileScope } from '@/api/client'
import { type McpOAuthFlow, mcpOAuthRpc } from '@/api/mcp'

import { isMissingRpcMethod } from './gateway-rpc'

interface CompleteOptions {
  serverName: string
  profile?: ProfileScope
  cancelled?: () => boolean
  sleep?: (milliseconds: number) => Promise<void>
  maxPollFailures?: number
  timeoutMs?: number
}

interface OAuthResult {
  ok: boolean
  session_id?: string
  auth_url?: string
  status?: 'pending' | 'approved' | 'error'
  error_message?: string
  tools?: McpOAuthFlow['tools']
}

/** Deliberate cancellation is not an error toast. */
export class McpOAuthCancelled extends Error {
  constructor() {
    super('OAuth cancelled by user')
    this.name = 'McpOAuthCancelled'
  }
}

const defaultSleep = (milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds))
const UPDATE_BACKEND = 'Update the Scout backend to support Desktop MCP OAuth callbacks.'

function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()

  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1'
}

function isLoopbackCallback(uri: null | string): boolean {
  let url: URL

  try {
    url = new URL(uri || '')
  } catch {
    return false
  }

  return (
    url.protocol === 'http:' &&
    isLoopbackHost(url.hostname) &&
    Boolean(url.port) &&
    Number(url.port) !== 0 &&
    url.pathname === '/callback' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  )
}

async function backendOnThisMachine(): Promise<boolean> {
  const connectionId = capabilityScoped().connectionId

  if (!connectionId || connectionId === 'local') {
    return true
  }

  try {
    const connection = await window.scoutDesktop.getConnection()

    if (connection?.mode === 'local') {
      return true
    }

    if (connection?.baseUrl) {
      return isLoopbackHost(new URL(connection.baseUrl).hostname)
    }
  } catch {
    // The web/phone shell has no registry connection: the page origin is the backend.
  }

  try {
    return isLoopbackHost(window.location.hostname)
  } catch {
    return false
  }
}

async function openAuthUrl(url: string): Promise<void> {
  const open = window.scoutDesktop?.openExternal

  if (typeof open === 'function') {
    await open(url)

    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Remote gateways require the Desktop callback bridge. An explicitly local
 *  gateway can host its own loopback listener when that capability is absent. */
export async function completeMcpDesktopOAuth({
  serverName,
  profile,
  cancelled,
  sleep = defaultSleep,
  maxPollFailures = 3,
  timeoutMs = 360_000
}: CompleteOptions): Promise<McpOAuthFlow> {
  const deadline = Date.now() + timeoutMs
  const scope = capabilityScoped(profile)
  const rpc = mcpOAuthRpc(scope)
  const bridge = window.scoutDesktop.mcpOauth
  const sameMachine = await backendOnThisMachine()

  let listener: { id: string; redirectUri: string } | undefined
  let sessionId: string | undefined
  let authUrl: string | undefined
  let approved = false
  let closed = false
  let relayError: unknown

  const checkCancelled = () => {
    if (cancelled?.()) {
      throw new McpOAuthCancelled()
    }
  }

  const request = async (action: 'start' | 'poll' | 'callback' | 'cancel', params: Record<string, unknown>) => {
    const result = await rpc<OAuthResult>(action, { name: serverName, ...params })

    if (!result.ok) {
      throw new Error(result.error_message || 'MCP OAuth request failed')
    }

    return result
  }

  try {
    checkCancelled()

    if (bridge) {
      listener = await bridge.listen()
      checkCancelled()
    }

    const started = await request('start', listener ? { client_redirect_uri: listener.redirectUri } : {})
    sessionId = started.session_id
    authUrl = started.auth_url
    // Start may have created a flow while the user cancelled. Keep its id so
    // finally can release it, but do not launch a browser after cancellation.
    checkCancelled()

    if (!sessionId || !authUrl) {
      throw new Error('OAuth server did not provide an authorization URL and session')
    }

    const redirectUri = new URL(authUrl).searchParams.get('redirect_uri')

    // The backend hosts the callback when it did not take ours: a vendor that pins its loopback
    // redirect (Swiggy, Zepto — the SDK binds that exact port), or a flow started without a
    // client listener (web/phone). That loopback only receives the browser on the Scout machine,
    // which the backend opens; this client just polls. A matching listener means we hosted it.
    if (!listener || redirectUri !== listener.redirectUri) {
      if (!isLoopbackCallback(redirectUri)) {
        throw new Error(listener ? UPDATE_BACKEND : 'OAuth server did not provide a local loopback callback URL')
      }

      if (bridge && listener) {
        await bridge.cancel(listener.id).catch(() => {})
        listener = undefined
      }
    }

    const flowId = sessionId

    if (bridge && listener) {
      void bridge
        .wait(listener.id)
        .then(async callback => {
          if (closed || cancelled?.()) {
            return
          }

          if (!callback.state) {
            throw new Error(callback.error || 'OAuth callback did not include state')
          }

          // Omit a null iss: a backend that predates the RFC 9207 relay rejects unknown params (4000).
          const { iss, ...rest } = callback
          await request('callback', { session_id: flowId, ...rest, ...(iss ? { iss } : {}) })
        })
        .catch(error => {
          relayError = error
        })
    }

    // Client-hosted callback, or the backend is this same machine: open here. Otherwise the
    // backend already opened the sign-in page on the Scout host (pinned Zepto/Swiggy, phone).
    if (listener || sameMachine) {
      await openAuthUrl(authUrl)
    }
    let pollFailures = 0

    for (;;) {
      checkCancelled()

      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for MCP OAuth authorization')
      }

      if (relayError) {
        throw relayError
      }

      let current: OAuthResult

      try {
        current = await request('poll', { session_id: flowId })
        pollFailures = 0
      } catch (error) {
        if (++pollFailures >= maxPollFailures) {
          throw error
        }

        await sleep(1000)

        continue
      }

      checkCancelled()

      if (relayError) {
        throw relayError
      }

      if (current.status === 'approved') {
        approved = true

        return {
          flow_id: flowId,
          server_name: serverName,
          status: 'approved',
          authorization_url: authUrl,
          error: null,
          tools: current.tools
        }
      }

      if (current.status === 'error') {
        throw new Error(current.error_message || 'OAuth authorization failed')
      }

      await sleep(1000)
    }
  } catch (error) {
    if (isMissingRpcMethod(error)) {
      throw new Error(UPDATE_BACKEND)
    }

    throw error
  } finally {
    closed = true

    // Stop the native waiter first: its synthetic cancellation is NOT a
    // provider callback and must never race cleanup back onto the gateway.
    if (bridge && listener) {
      await bridge.cancel(listener.id).catch(() => {})
    }

    if (sessionId && !approved) {
      try {
        await request('cancel', { session_id: sessionId })
      } catch (error) {
        // Relay-capable backends predating oauth.cancel can still release a
        // waiting worker with a state-checked denial. No HTTP redirect retry.
        if (isMissingRpcMethod(error) && authUrl) {
          const state = new URL(authUrl).searchParams.get('state')

          if (state) {
            await request('callback', { session_id: sessionId, state, error: 'access_denied' }).catch(() => {})
          }
        }
        // Network cleanup is best-effort; backend callback timeout is bounded.
      }
    }
  }
}
