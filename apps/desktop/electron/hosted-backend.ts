/**
 * The one Scout backend this app talks to. Desktop never installs, spawns or
 * tunnels to a backend of its own: the URL is fixed at build time from
 * `apps/desktop/backend.json` (see scripts/bundle-electron-main.mjs).
 */

declare const __SCOUT_BACKEND_URL__: string | undefined

const FALLBACK_BACKEND_URL = 'http://127.0.0.1:9119'

export const HOSTED_BACKEND_URL: string =
  typeof __SCOUT_BACKEND_URL__ === 'string' && __SCOUT_BACKEND_URL__ ? __SCOUT_BACKEND_URL__ : FALLBACK_BACKEND_URL

export const HOSTED_CONNECTION_ID = 'hosted'

/** The connection registry the renderer sees: exactly one source, the hosted backend. */
export function hostedConnectionsRegistry() {
  return {
    version: 2,
    primary: HOSTED_CONNECTION_ID,
    launchMode: 'primary' as const,
    secureTokenStorage: true,
    connections: [
      {
        id: HOSTED_CONNECTION_ID,
        kind: 'remote' as const,
        label: new URL(HOSTED_BACKEND_URL).host,
        url: HOSTED_BACKEND_URL,
        authMode: 'token' as const,
        tokenSet: true,
        tokenPreview: null
      }
    ]
  }
}

export interface HostedRemote {
  authMode?: 'oauth' | 'token'
  baseUrl: string
  headers?: Record<string, string>
  remoteScoutVersion?: string
  remoteHost?: string
  source?: string
  token: unknown
  wsUrl: string
}

/** The renderer-facing descriptor for the hosted backend. */
export function createPrimaryRemoteConnection<State extends object>(
  remote: HostedRemote,
  logs: string[],
  windowState: State
) {
  return {
    baseUrl: remote.baseUrl,
    mode: 'remote' as const,
    source: remote.source,
    authMode: remote.authMode || 'token',
    remoteHost: remote.remoteHost,
    remoteKind: 'url' as const,
    remoteScoutVersion: remote.remoteScoutVersion,
    connectionId: HOSTED_CONNECTION_ID,
    headers: remote.headers,
    token: remote.token,
    wsUrl: remote.wsUrl,
    logs,
    ...windowState
  }
}
