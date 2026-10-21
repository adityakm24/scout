// The renderer outside Electron (the phone app's web view, a plain browser): a `window.scoutDesktop`
// that talks to one remote Scout backend over HTTP and its /api/ws socket, standing in for the
// preload bridge (electron/preload.ts). Only what a remote client can do is real — the connection,
// REST calls, notifications; machine-local features (terminal, git, windows, updates) answer as
// "not available here" through the defaults at the bottom instead of throwing.
//
// The backend is the page's own origin (the dev server proxies /api to it, see vite.config.ts);
// the session token arrives once, from the native shell (`window.__SCOUT_REMOTE__`) or a
// `?token=` link, and is kept for this origin so a reload does not need it again.

import type { ScoutApiRequest, ScoutConnection } from '@/global'

import type { ScoutNotification } from '../../electron/notification-types'

interface RemoteConfig {
  baseUrl: string
  token: string
}

declare global {
  interface Window {
    /** Set by the phone app's native shell before the page loads. */
    __SCOUT_REMOTE__?: Partial<RemoteConfig>
  }
}

const TOKEN_KEY = 'scout.remote.token'

/** Dispatched on `window` by the phone shell with a chat's stored id as `detail`. */
export const FOCUS_SESSION_EVENT = 'scout:focus-session'

function readToken(): string {
  const url = new URL(window.location.href)
  const fromLink = url.searchParams.get('token')

  if (fromLink) {
    // Keep it out of the address bar, history and any screenshot of the page.
    url.searchParams.delete('token')
    window.history.replaceState(null, '', url.toString())
  }

  const token = window.__SCOUT_REMOTE__?.token || fromLink || ''

  try {
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token)
    }

    return token || window.localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return token
  }
}

function remoteConfig(): RemoteConfig {
  return { baseUrl: (window.__SCOUT_REMOTE__?.baseUrl || window.location.origin).replace(/\/$/, ''), token: readToken() }
}

function connectionFor({ baseUrl, token }: RemoteConfig, profile?: null | string): ScoutConnection {
  return {
    windowButtonPosition: null,
    baseUrl,
    isFullscreen: false,
    logs: [],
    mode: 'remote',
    nativeOverlayWidth: 0,
    profile: profile ?? undefined,
    remoteHost: new URL(baseUrl).host,
    remoteKind: 'url',
    source: 'settings',
    token,
    wsUrl: `${baseUrl.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(token)}`
  }
}

async function apiRequest<T>({ baseUrl, token }: RemoteConfig, request: ScoutApiRequest): Promise<T> {
  const headers: Record<string, string> = { 'X-Scout-Session-Token': token }
  let body: BodyInit | undefined

  if (request.upload) {
    const form = new FormData()
    form.append(
      'file',
      new Blob([request.upload.bytes], { type: request.upload.contentType || 'application/octet-stream' }),
      request.upload.filename
    )
    body = form
  } else if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(request.body)
  }

  const controller = new AbortController()
  const timer = request.timeoutMs ? setTimeout(() => controller.abort(), request.timeoutMs) : undefined

  try {
    const response = await fetch(`${baseUrl}${request.path}`, {
      body,
      headers,
      method: request.method || 'GET',
      signal: controller.signal
    })

    const text = await response.text()

    if (!response.ok) {
      throw new Error(`${response.status}: ${text || response.statusText}`)
    }

    return (text ? JSON.parse(text) : null) as T
  } finally {
    clearTimeout(timer)
  }
}

/** What every Electron-only member resolves to: a namespace whose members are the same, a call
 *  whose result is at once an unsubscribe (callable) and an empty result (awaitable). */
function inert(): unknown {
  const result = Object.assign(() => {}, {
    catch: () => Promise.resolve(undefined),
    finally: (done?: () => void) => Promise.resolve(undefined).finally(done),
    then: (resolve?: (value: undefined) => unknown) => Promise.resolve(undefined).then(resolve)
  })

  return new Proxy(() => {}, {
    apply: () => result,
    // A namespace is never itself awaited as a promise.
    get: (_target, key) => (key === 'then' ? undefined : inert())
  })
}

/** Optional bridge members (`hud?`, `git?`, `onDeepLink?`…) are feature-detected — older shells
 *  lack them and the renderer already copes — so here they are simply absent. */
const ABSENT = new Set(
  (
    'getAgentRoster chatOnboarding hud screenshot hudModifier readWindowBelow ' +
    'readFileDataUrlForAttach dataUrlReadMax readPluginSource selectSavePath saveGatewayFile contextMenuEdit ' +
    'contextMenuCopyImage contextMenuSpellcheck contextMenuGuestAddWord onContextMenuSpellcheck capturePreview ' +
    'watchDirectory setActiveWork setTitleBarTheme setNativeTheme setTranslucency setKeepAwake minimizeToTray ' +
    'setPreviewShortcutActive onExternalOpenFailed mcpOauth openPreviewInBrowser resolveFavicon zoom ' +
    'reportRendererError logLine gitRoot revealPath openDir desktopPluginsRoot reconcileDesktopPlugins logsRoot ' +
    'agentPluginsRoot renamePath writeTextFile trashPath git reachPreviewUrl setActiveConnectionRoute ' +
    'onClosePreviewRequested onPreviewNav onOpenFolderRequested onOpenUpdatesRequested onDeepLink ' +
    'signalDeepLinkReady probePluginRepo installDesktopPlugin removeDesktopPlugin onWindowStateChanged ' +
    'onNotificationAction onNotificationActivate onPoolBackendRetiring onConnectionApplied ' +
    'onPowerResume getOnBattery onBatteryChanged recycleBackend getMachineProfile relaunchApp ' +
    'getRemoteDisplayReason'
  ).split(' ')
)

function withFallbacks<T extends object>(target: T, absent: ReadonlySet<string> = new Set()): T {
  return new Proxy(target, {
    get(object, key) {
      if (typeof key !== 'string' || key in object) {
        return Reflect.get(object, key)
      }

      return absent.has(key) ? undefined : inert()
    },
    has: (object, key) => key in object || (typeof key === 'string' && !absent.has(key))
  })
}

function webBridge(config: RemoteConfig) {
  const connection = (profile?: null | string) => Promise.resolve(connectionFor(config, profile))

  const activeProfile = { name: 'default', profile: 'default' }

  return withFallbacks({
    api: <T>(request: ScoutApiRequest) => apiRequest<T>(config, request),
    connections: withFallbacks({
      list: async () => ({ connections: [], launchMode: 'primary', primaryId: null })
    }),
    // Feature flags read as booleans: an inert proxy would be truthy.
    glassSupported: false,
    guestOnboardingEnabled: false,
    localModelsEnabled: false,
    localSkin: null,
    translucencySupported: false,
    getBootProgress: async () => ({ done: true, logs: [], phase: 'ready', progress: 1 }),
    getConnection: (profile?: null | string) => connection(profile),
    getGatewayWsUrlFor: async ({ profile }: { profile?: null | string }) => ({
      ok: true,
      wsUrl: connectionFor(config, profile).wsUrl
    }),
    getConnectionFor: ({ profile }: { profile?: null | string }) => connection(profile),
    // The phone shell opens a chat when its notification is tapped (mobile/src/ScoutScreen.tsx),
    // including the tap that launched the app before this page was listening.
    onFocusSession: (callback: (sessionId: string) => void) => {
      const open = (event: Event) => callback(String((event as CustomEvent<string>).detail ?? ''))

      window.addEventListener(FOCUS_SESSION_EVENT, open)
      void window.scoutNative
        ?.request<null | string>('take-focus')
        .then(sessionId => sessionId && callback(sessionId))
        .catch(() => undefined)

      return () => window.removeEventListener(FOCUS_SESSION_EVENT, open)
    },
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    notify: async ({ body, focusSessionId, sessionId, title }: ScoutNotification) => {
      // In the phone app the OS posts it (mobile/src/ScoutScreen.tsx); web views have no Notification.
      if (window.scoutNative) {
        return window.scoutNative
          .request<boolean>('notify', { body, sessionId: focusSessionId ?? sessionId, title })
          .catch(() => false)
      }

      if (!('Notification' in window) || Notification.permission !== 'granted') {
        return false
      }

      new Notification(title || 'Scout', { body })

      return true
    },
    platform: 'web',
    profile: withFallbacks({
      get: async () => activeProfile,
      getDefault: async () => null,
      remember: async () => activeProfile
    }),
    revalidateConnection: async () => ({ ok: true, rebuilt: false }),
    // The OS draws (or, in the phone shell, has) no window chrome to imitate.
    windowControls: withFallbacks({ custom: false })
  }, ABSENT)
}

if (typeof window !== 'undefined' && !window.scoutDesktop) {
  window.scoutDesktop = webBridge(remoteConfig()) as unknown as Window['scoutDesktop']
}
