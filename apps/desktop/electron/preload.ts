import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

import type { DesktopProfileRoute } from './desktop-profile'
import type { HudModifierApi, HudModifierStatus } from './hud-modifier-types'
import { customWindowControlsEnabled } from './window-controls'

// Which translucency the OS can back. Asked synchronously because the renderer
// needs it before its first paint, and answered by main because deciding it
// needs `os.release()` — a sandboxed preload may only require electron, events,
// timers and url, so importing node:os here throws before contextBridge runs
// and takes the ENTIRE bridge down with it (window.scoutDesktop undefined =>
// "Desktop IPC bridge is unavailable"). No reply means no glass, which degrades
// to an ordinary opaque window rather than a page thinned over nothing.
const translucencySupport = ipcRenderer.sendSync('scout:translucency:support')
const hudWindowing = ipcRenderer.sendSync('scout:hud:windowing')
const hudNativeDrag = hudWindowing?.nativeDrag === true

const launchFlags: { localModels?: boolean; guestOnboarding?: boolean } | undefined =
  ipcRenderer.sendSync('scout:feature-flags')

// Local, sanitized skin payload for the first renderer theme paint. This does
// not wait on `gateway.ready`, so an unreachable remote primary cannot force
// the built-in palette over the skin configured on this machine.
const localSkin = ipcRenderer.sendSync('scout:skin:local')

contextBridge.exposeInMainWorld('scoutDesktop', {
  glassSupported: translucencySupport?.glass === true,
  translucencySupported: translucencySupport?.translucency === true,
  // Launch-flag fact: the app was started with --local, so the renderer may
  // show the local-models surfaces. Static for the window's lifetime.
  localModelsEnabled: launchFlags?.localModels === true,
  // Launch-flag fact: the SpaceshipResearch free tier is on for this launch
  // (SCOUT_GUEST_ONBOARDING=1 or --guest-onboarding). Read-only; the same
  // decision is stamped onto every backend the app spawns.
  guestOnboardingEnabled: launchFlags?.guestOnboarding === true,
  localSkin: localSkin && typeof localSkin === 'object' ? localSkin : null,
  getConnection: (profile, opts) => ipcRenderer.invoke('scout:connection', profile, opts),
  // Registry-scoped backend resolution: { connectionId, profile } → descriptor.
  getConnectionFor: payload => ipcRenderer.invoke('scout:connection:for', payload),
  getProfileRoutes: profiles => ipcRenderer.invoke('scout:plugin-profile-routes', profiles),
  revalidateConnection: () => ipcRenderer.invoke('scout:connection:revalidate'),
  touchBackend: (profile, options) => ipcRenderer.invoke('scout:backend:touch', profile, options),
  getPoolLimits: () => ipcRenderer.invoke('scout:pool-limits:get'),
  setPoolLimits: limits => ipcRenderer.invoke('scout:pool-limits:set', limits),
  getGatewayWsUrl: profile => ipcRenderer.invoke('scout:gateway:ws-url', profile),
  // Registry-scoped fresh WS URL: { connectionId, profile } → result shape of
  // getGatewayWsUrl, minted against that connection's backend.
  getGatewayWsUrlFor: payload => ipcRenderer.invoke('scout:gateway:ws-url-for', payload),
  // Union agent roster across every registered connection.
  getAgentRoster: () => ipcRenderer.invoke('scout:agents:roster'),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('scout:window:openSession', sessionId, opts),
  openSessionInTerminal: (sessionId, opts) => ipcRenderer.invoke('scout:window:openInTerminal', sessionId, opts),
  openWindow: (options?: DesktopProfileRoute) => ipcRenderer.invoke('scout:window:openInstance', options),
  openBrowserWindow: tabId => ipcRenderer.invoke('scout:window:openBrowser', tabId),
  onBrowserPopoutClosed: callback => {
    const listener = (_event, tabId) => callback(tabId)
    ipcRenderer.on('scout:browser-popout:closed', listener)

    return () => ipcRenderer.removeListener('scout:browser-popout:closed', listener)
  },
  claimAmbientCue: key => ipcRenderer.invoke('scout:ambient:claim', key),
  windowControls: {
    custom: customWindowControlsEnabled(),
    minimize: () => ipcRenderer.send('scout:window-control', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('scout:window-control', 'toggle-maximize'),
    close: () => ipcRenderer.send('scout:window-control', 'close')
  },
  wakeIndicator: {
    getState: () => ipcRenderer.invoke('scout:wake-indicator:get'),
    setState: state => ipcRenderer.send('scout:wake-indicator:set', state),
    onState: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('scout:wake-indicator:state', listener)

      return () => ipcRenderer.removeListener('scout:wake-indicator:state', listener)
    }
  },
  chatOnboarding: {
    grow: request => ipcRenderer.send('scout:chat-onboarding:grow', request),
    soloBoot: () => ipcRenderer.send('scout:chat-onboarding:solo-boot')
  },
  petOverlay: {
    // Main renderer → main process: window lifecycle + drag. `request` is
    // `{ bounds, screen }`; resolves with the screen bounds it actually used.
    open: request => ipcRenderer.invoke('scout:pet-overlay:open', request),
    close: () => ipcRenderer.invoke('scout:pet-overlay:close'),
    setBounds: bounds => ipcRenderer.send('scout:pet-overlay:set-bounds', bounds),
    setIgnoreMouse: ignore => ipcRenderer.send('scout:pet-overlay:ignore-mouse', ignore),
    // Flip the overlay focusable (and focus it) while the composer needs keys.
    setFocusable: focusable => ipcRenderer.send('scout:pet-overlay:set-focusable', focusable),
    // Main renderer → overlay (forwarded by main): push the latest pet state.
    pushState: payload => ipcRenderer.send('scout:pet-overlay:state', payload),
    // Overlay → main renderer (forwarded by main): pop back in / composer submit.
    control: payload => ipcRenderer.send('scout:pet-overlay:control', payload),
    // Overlay subscribes to state pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('scout:pet-overlay:state', listener)

      return () => ipcRenderer.removeListener('scout:pet-overlay:state', listener)
    },
    // Main renderer subscribes to overlay control messages.
    onControl: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('scout:pet-overlay:control', listener)

      return () => ipcRenderer.removeListener('scout:pet-overlay:control', listener)
    }
  },
  // HUD mode: the chrome-free floating chat. A full app renderer (own gateway)
  // sized as a floating bar, so it mounts the real composer. Main owns the
  // window; `onChanged` keeps every window's toggle truthful.
  hud: {
    nativeDrag: hudNativeDrag,
    windowing: {
      clientPlacement: hudWindowing?.clientPlacement !== false,
      controlDrag: hudWindowing?.controlDrag === true,
      nativeDrag: hudNativeDrag,
      solid: hudWindowing?.solid === true,
      workspaceTransfer: hudWindowing?.workspaceTransfer === true
    },
    open: request => ipcRenderer.invoke('scout:hud:open', request),
    close: () => ipcRenderer.invoke('scout:hud:close'),
    setIgnoreMouse: ignore => ipcRenderer.send('scout:hud:ignore-mouse', ignore),
    beginMove: () => ipcRenderer.send('scout:hud:begin-move'),
    endMove: () => ipcRenderer.send('scout:hud:end-move'),
    moveBy: delta => ipcRenderer.send('scout:hud:move-by', delta),
    setWorkspaceTransfer: transferring => ipcRenderer.send('scout:hud:workspace-transfer', transferring),
    setBounds: bounds => ipcRenderer.send('scout:hud:set-bounds', bounds),
    resetLayout: () => ipcRenderer.invoke('scout:hud:reset-layout'),
    // Whether the band covers the window below the bar. Main pairs it with the
    // user's translucency setting to decide the native frost (macOS vibrancy /
    // Windows 11 DWM backdrop) — see hudFrostFor.
    setFrost: showing => ipcRenderer.invoke('scout:hud:frost', showing),
    // The HUD tells main which session it is on; main hands that back to the
    // app window when the HUD closes, so the app can re-home onto it.
    setSession: sessionId => ipcRenderer.send('scout:hud:session', sessionId),
    onGoto: callback => {
      const listener = (_event, sessionId) => callback(sessionId)
      ipcRenderer.on('scout:hud:goto', listener)

      return () => ipcRenderer.removeListener('scout:hud:goto', listener)
    },
    onChanged: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('scout:hud:changed', listener)

      return () => ipcRenderer.removeListener('scout:hud:changed', listener)
    },
    // Linux only, and silent elsewhere: where the cursor is, in page
    // coordinates, or null when it has left the window. Stands in for the
    // mousemove that `setIgnoreMouseEvents(true, { forward: true })` delivers on
    // macOS and Windows but not here.
    onCursor: callback => {
      const listener = (_event, point) => callback(point)
      ipcRenderer.on('scout:hud:cursor', listener)

      return () => ipcRenderer.removeListener('scout:hud:cursor', listener)
    },
    // Main's game-overlay watch: whether a fullscreen app (a game) is under
    // the HUD, so the renderer can step back to the low-opacity overlay
    // treatment while one owns the screen.
    onGameOverlay: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('scout:hud:game-overlay', listener)

      return () => ipcRenderer.removeListener('scout:hud:game-overlay', listener)
    }
  },
  hudModifier: {
    getSettings: () => ipcRenderer.invoke('scout:hud-modifier:settings:get'),
    setEnabled: enabled => ipcRenderer.invoke('scout:hud-modifier:settings:set', enabled),
    openPermissionSettings: () => ipcRenderer.invoke('scout:hud-modifier:permission'),
    onStatus: callback => {
      const listener = (_event: Electron.IpcRendererEvent, status: HudModifierStatus) => callback(status)
      ipcRenderer.on('scout:hud-modifier:status', listener)

      return () => ipcRenderer.removeListener('scout:hud-modifier:status', listener)
    }
  } satisfies HudModifierApi,
  // macOS native screenshot gesture; captures require a main-issued request.
  screenshot:
    process.platform === 'darwin'
      ? {
          getSettings: () => ipcRenderer.invoke('scout:screenshot:settings:get'),
          setEnabled: enabled => ipcRenderer.invoke('scout:screenshot:settings:set', enabled),
          openPermissionSettings: kind => ipcRenderer.invoke('scout:screenshot:permission', kind),
          capture: requestId => ipcRenderer.invoke('scout:screenshot:capture', requestId),
          onStatus: callback => {
            const listener = (_event, status) => callback(status)
            ipcRenderer.on('scout:screenshot:status', listener)

            return () => ipcRenderer.removeListener('scout:screenshot:status', listener)
          },
          onRequest: callback => {
            const channel = 'scout:screenshot:request'
            const listener = (_event, requestId) => callback(requestId)

            if (ipcRenderer.listenerCount(channel) === 0) {
              ipcRenderer.send('scout:screenshot:subscribe', true)
            }

            ipcRenderer.on(channel, listener)

            return () => {
              ipcRenderer.removeListener(channel, listener)

              if (ipcRenderer.listenerCount(channel) === 0) {
                ipcRenderer.send('scout:screenshot:subscribe', false)
              }
            }
          }
        }
      : undefined,
  // Quick Entry: the global-hotkey mini composer window. Main owns the OS
  // shortcut + the persisted preference; the quick window only captures text
  // and hands it back, and the primary renderer submits it through the normal
  // prompt path.
  quickEntry: {
    getSettings: () => ipcRenderer.invoke('scout:quick-entry:settings:get'),
    setSettings: patch => ipcRenderer.invoke('scout:quick-entry:settings:set', patch),
    submit: payload => ipcRenderer.send('scout:quick-entry:submit', payload),
    dismiss: () => ipcRenderer.send('scout:quick-entry:dismiss'),
    // Primary renderer → main → quick window: gateway connection state + the
    // recent-session options the target picker offers. Main caches the latest
    // payload so a freshly spawned quick window starts from truth.
    pushState: payload => ipcRenderer.send('scout:quick-entry:state', payload),
    // Quick window subscribes to those pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('scout:quick-entry:state', listener)

      return () => ipcRenderer.removeListener('scout:quick-entry:state', listener)
    },
    // Main → primary renderer: a submit captured by the quick window.
    onSubmit: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('scout:quick-entry:submit', listener)

      return () => ipcRenderer.removeListener('scout:quick-entry:submit', listener)
    },
    // Main → quick window: you were just summoned (reset draft + refocus).
    onShown: callback => {
      const listener = () => callback()
      ipcRenderer.on('scout:quick-entry:shown', listener)

      return () => ipcRenderer.removeListener('scout:quick-entry:shown', listener)
    }
  },
  getBootProgress: () => ipcRenderer.invoke('scout:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('scout:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('scout:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('scout:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('scout:connection-config:test', payload),
  // Opt-in OS-keychain encryption for stored gateway secrets (default off —
  // see secret-storage-policy.ts). get never touches the OS keychain.
  getSecretStorageEncryption: () => ipcRenderer.invoke('scout:secret-storage:get'),
  setSecretStorageEncryption: (on: boolean) => ipcRenderer.invoke('scout:secret-storage:set', on),
  // v2 multi-connection registry: named agent sources (local / remote / cloud / ssh).
  connections: {
    list: () => ipcRenderer.invoke('scout:connections:list'),
    save: payload => ipcRenderer.invoke('scout:connections:save', payload),
    remove: id => ipcRenderer.invoke('scout:connections:remove', id),
    setPrimary: id => ipcRenderer.invoke('scout:connections:set-primary', id),
    setLaunchMode: mode => ipcRenderer.invoke('scout:connections:set-launch-mode', mode),
    setLastUsed: id => ipcRenderer.invoke('scout:connections:set-last-used', id),
    test: id => ipcRenderer.invoke('scout:connections:test', id),
    updateManaged: id => ipcRenderer.invoke('scout:connections:update-managed', id),
    // Fan out `scout update` to every eligible registered connection.
    // Optional excludeIds skips rows the caller updates through another path.
    updateAll: options => ipcRenderer.invoke('scout:connections:update-all', options),
    // Registry lifecycle push (main → renderer): a connection was removed or
    // materially edited, so secondaries scoped to it must be disposed (and,
    // for edits, re-dialed at the new target).
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('scout:connections:changed', listener)

      return () => ipcRenderer.removeListener('scout:connections:changed', listener)
    }
  },
  sshConfigHosts: () => ipcRenderer.invoke('scout:ssh-config:hosts'),
  sshResolveHost: host => ipcRenderer.invoke('scout:ssh-config:resolve', host),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('scout:connection-config:probe', remoteUrl),
  // `options` lets a registry-editor draft sign in BEFORE it is saved: the
  // main process settles the draft's connection id up front so the login
  // window writes into the per-connection cookie jar the saved entry will
  // read (not the legacy shared jar an unsaved URL would fall back to).
  oauthLoginConnectionConfig: (remoteUrl, options) =>
    ipcRenderer.invoke('scout:connection-config:oauth-login', remoteUrl, options),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('scout:connection-config:oauth-logout', remoteUrl),
  // Scout Cloud: one portal login powers discovery + silent per-agent sign-in
  // (cloud-auto-discovery Phase 3).
  cloud: {
    status: () => ipcRenderer.invoke('scout:cloud:status'),
    login: () => ipcRenderer.invoke('scout:cloud:login'),
    logout: () => ipcRenderer.invoke('scout:cloud:logout'),
    discover: org => ipcRenderer.invoke('scout:cloud:discover', org),
    agentSignIn: dashboardUrl => ipcRenderer.invoke('scout:cloud:agent-sign-in', dashboardUrl)
  },
  profile: {
    getDefault: () => ipcRenderer.invoke('scout:profile:default:get'),
    setDefault: (route: DesktopProfileRoute) => ipcRenderer.invoke('scout:profile:default:set', route),
    onDefaultChanged: (callback: (route: DesktopProfileRoute | null) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, route: DesktopProfileRoute | null) => callback(route)
      ipcRenderer.on('scout:profile:default:changed', listener)

      return () => ipcRenderer.removeListener('scout:profile:default:changed', listener)
    },
    get: () => ipcRenderer.invoke('scout:profile:get'),
    remember: name => ipcRenderer.invoke('scout:profile:remember', name),
    set: name => ipcRenderer.invoke('scout:profile:set', name)
  },
  api: request => ipcRenderer.invoke('scout:api', request),
  notify: payload => ipcRenderer.invoke('scout:notify', payload),
  claimStartupLatency: () => ipcRenderer.invoke('scout:startup-latency:claim'),
  requestMicrophoneAccess: () => ipcRenderer.invoke('scout:requestMicrophoneAccess'),
  readWindowBelow: () => ipcRenderer.invoke('scout:window:readBelow'),
  readFileDataUrl: filePath => ipcRenderer.invoke('scout:readFileDataUrl', filePath),
  readFileDataUrlForAttach: filePath => ipcRenderer.invoke('scout:readFileDataUrlForAttach', filePath),
  dataUrlReadMax: {
    get: () => ipcRenderer.invoke('scout:data-url-read-max:get'),
    set: maxMb => ipcRenderer.invoke('scout:data-url-read-max:set', maxMb)
  },
  readFileText: filePath => ipcRenderer.invoke('scout:readFileText', filePath),
  readPluginSource: (filePath: string) => ipcRenderer.invoke('scout:readPluginSource', filePath),
  selectPaths: options => ipcRenderer.invoke('scout:selectPaths', options),
  selectSavePath: options => ipcRenderer.invoke('scout:selectSavePath', options),
  writeClipboard: text => ipcRenderer.invoke('scout:writeClipboard', text),
  readClipboard: () => ipcRenderer.invoke('scout:readClipboard'),
  saveGatewayFile: payload => ipcRenderer.invoke('scout:saveGatewayFile', payload),
  saveImageFromUrl: url => ipcRenderer.invoke('scout:saveImageFromUrl', url),
  contextMenuEdit: command => ipcRenderer.invoke('scout:context-menu:edit', command),
  contextMenuCopyImage: () => ipcRenderer.invoke('scout:context-menu:copy-image'),
  contextMenuSpellcheck: action => ipcRenderer.invoke('scout:context-menu:spellcheck', action),
  contextMenuGuestAddWord: payload => ipcRenderer.invoke('scout:context-menu:guest-add-word', payload),
  onContextMenuSpellcheck: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('scout:context-menu-spellcheck', listener)

    return () => ipcRenderer.removeListener('scout:context-menu-spellcheck', listener)
  },
  saveImageBuffer: (data, ext, name) => ipcRenderer.invoke('scout:saveImageBuffer', { data, ext, name }),
  capturePreview: payload => ipcRenderer.invoke('scout:capturePreview', payload),
  savePastedText: text => ipcRenderer.invoke('scout:savePastedText', { text }),
  saveClipboardImage: () => ipcRenderer.invoke('scout:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('scout:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('scout:watchPreviewFile', url),
  watchDirectory: dir => ipcRenderer.invoke('scout:watchDirectory', dir),
  stopPreviewFileWatch: id => ipcRenderer.invoke('scout:stopPreviewFileWatch', id),
  setActiveWork: payload => ipcRenderer.send('scout:active-work', payload),
  setTitleBarTheme: payload => ipcRenderer.send('scout:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('scout:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('scout:translucency', payload),
  setKeepAwake: on => ipcRenderer.send('scout:keep-awake', on),
  minimizeToTray: {
    get: () => ipcRenderer.invoke('scout:minimize-to-tray:get'),
    set: on => ipcRenderer.invoke('scout:minimize-to-tray:set', on),
    onChanged: callback => {
      const listener = (_event, status) => callback(status)
      ipcRenderer.on('scout:minimize-to-tray:changed', listener)

      return () => ipcRenderer.removeListener('scout:minimize-to-tray:changed', listener)
    }
  },
  setDisableF12: blocked => ipcRenderer.send('scout:devtools:disable-f12', blocked),
  setF12ShortcutActive: active => ipcRenderer.send('scout:f12ShortcutActive', Boolean(active)),
  onF12Shortcut: callback => {
    const listener = (_event, input) => callback(input)
    ipcRenderer.on('scout:f12-shortcut', listener)

    return () => ipcRenderer.removeListener('scout:f12-shortcut', listener)
  },
  setPreviewShortcutActive: active => ipcRenderer.send('scout:previewShortcutActive', Boolean(active)),
  openExternal: url => ipcRenderer.invoke('scout:openExternal', url),
  mcpOauth: {
    // One-shot loopback listener for MCP OAuth against remote backends: bind
    // on this machine, hand redirectUri to mcp.servers.oauth.start, then wait
    // for the provider redirect and relay code/state via oauth.callback.
    listen: () => ipcRenderer.invoke('scout:mcp-oauth:listen'),
    wait: (id, timeoutMs) => ipcRenderer.invoke('scout:mcp-oauth:wait', id, timeoutMs),
    cancel: id => ipcRenderer.invoke('scout:mcp-oauth:cancel', id)
  },
  openPreviewInBrowser: url => ipcRenderer.invoke('scout:openPreviewInBrowser', url),
  reachPreviewUrl: url => ipcRenderer.invoke('scout:preview:reach', url),
  setActiveConnectionRoute: route => ipcRenderer.send('scout:connection:active-route', route),
  fetchLinkTitle: url => ipcRenderer.invoke('scout:fetchLinkTitle', url),
  resolveFavicon: url => ipcRenderer.invoke('scout:resolveFavicon', url),
  sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('scout:workspace:sanitize', cwd),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('scout:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('scout:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('scout:setting:defaultProjectDir:pick')
  },
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => ipcRenderer.invoke('scout:zoom:get'),
    // Synchronous zoom factor (1 = 100%). Coordinate math needs it in the
    // same tick as the event it converts, so no IPC round-trip here.
    factor: () => webFrame.getZoomFactor(),
    setPercent: percent => ipcRenderer.send('scout:zoom:set-percent', percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('scout:zoom:changed', listener)

      return () => ipcRenderer.removeListener('scout:zoom:changed', listener)
    }
  },
  revealLogs: () => ipcRenderer.invoke('scout:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('scout:logs:recent'),
  // Fire-and-forget: persists a renderer error-boundary catch (with component
  // stack) to desktop.log so crashes survive the window (#79428).
  reportRendererError: report => ipcRenderer.send('scout:logs:renderer-error', report),
  logLine: (line: string): void => ipcRenderer.send('scout:logs:renderer-line', line),
  readDir: dirPath => ipcRenderer.invoke('scout:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('scout:fs:gitRoot', startPath),
  revealPath: targetPath => ipcRenderer.invoke('scout:fs:reveal', targetPath),
  openDir: dirPath => ipcRenderer.invoke('scout:fs:openDir', dirPath),
  desktopPluginsRoot: () => ipcRenderer.invoke('scout:fs:desktopPluginsRoot'),
  reconcileDesktopPlugins: () => ipcRenderer.invoke('scout:fs:reconcileDesktopPlugins'),
  logsRoot: (profile?: string) => ipcRenderer.invoke('scout:fs:logsRoot', profile),
  renamePath: (targetPath, newName) => ipcRenderer.invoke('scout:fs:rename', targetPath, newName),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('scout:fs:writeText', filePath, content),
  trashPath: targetPath => ipcRenderer.invoke('scout:fs:trash', targetPath),
  git: {
    worktreeList: repoPath => ipcRenderer.invoke('scout:git:worktreeList', repoPath),
    worktreeAdd: (repoPath, options) => ipcRenderer.invoke('scout:git:worktreeAdd', repoPath, options),
    worktreeRemove: (repoPath, worktreePath, options) =>
      ipcRenderer.invoke('scout:git:worktreeRemove', repoPath, worktreePath, options),
    branchSwitch: (repoPath, branch) => ipcRenderer.invoke('scout:git:branchSwitch', repoPath, branch),
    branchList: repoPath => ipcRenderer.invoke('scout:git:branchList', repoPath),
    baseBranchList: repoPath => ipcRenderer.invoke('scout:git:baseBranchList', repoPath),
    repoStatus: repoPath => ipcRenderer.invoke('scout:git:repoStatus', repoPath),
    fileDiff: (repoPath, filePath) => ipcRenderer.invoke('scout:git:fileDiff', repoPath, filePath),
    scanRepos: (roots, options) => ipcRenderer.invoke('scout:git:scanRepos', roots, options),
    review: {
      list: (repoPath, scope, baseRef) => ipcRenderer.invoke('scout:git:review:list', repoPath, scope, baseRef),
      diff: (repoPath, filePath, scope, baseRef, staged) =>
        ipcRenderer.invoke('scout:git:review:diff', repoPath, filePath, scope, baseRef, staged),
      stage: (repoPath, filePath) => ipcRenderer.invoke('scout:git:review:stage', repoPath, filePath),
      unstage: (repoPath, filePath) => ipcRenderer.invoke('scout:git:review:unstage', repoPath, filePath),
      revert: (repoPath, filePath) => ipcRenderer.invoke('scout:git:review:revert', repoPath, filePath),
      revParse: (repoPath, ref) => ipcRenderer.invoke('scout:git:review:revParse', repoPath, ref),
      commit: (repoPath, message, push) => ipcRenderer.invoke('scout:git:review:commit', repoPath, message, push),
      commitContext: repoPath => ipcRenderer.invoke('scout:git:review:commitContext', repoPath),
      push: repoPath => ipcRenderer.invoke('scout:git:review:push', repoPath),
      shipInfo: repoPath => ipcRenderer.invoke('scout:git:review:shipInfo', repoPath),
      prList: (repoPath, branches, numbers) =>
        ipcRenderer.invoke('scout:git:review:prList', repoPath, branches, numbers),
      createPr: repoPath => ipcRenderer.invoke('scout:git:review:createPr', repoPath)
    }
  },
  terminal: {
    attach: id => ipcRenderer.invoke('scout:terminal:attach', id),
    cwd: id => ipcRenderer.invoke('scout:terminal:cwd', id),
    dispose: id => ipcRenderer.invoke('scout:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('scout:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('scout:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('scout:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `scout:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `scout:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('scout:close-preview-requested', listener)

    return () => ipcRenderer.removeListener('scout:close-preview-requested', listener)
  },
  onPreviewNav: callback => {
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('scout:preview-nav', listener)

    return () => ipcRenderer.removeListener('scout:preview-nav', listener)
  },
  onOpenFolderRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('scout:open-folder-requested', listener)

    return () => ipcRenderer.removeListener('scout:open-folder-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('scout:open-updates', listener)

    return () => ipcRenderer.removeListener('scout:open-updates', listener)
  },
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('scout:deep-link', listener)

    return () => ipcRenderer.removeListener('scout:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('scout:deep-link-ready'),
  probePluginRepo: payload => ipcRenderer.invoke('scout:plugin:probe', payload),
  installDesktopPlugin: payload => ipcRenderer.invoke('scout:plugin:installDesktop', payload),
  removeDesktopPlugin: payload => ipcRenderer.invoke('scout:plugin:removeDesktop', payload),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('scout:window-state-changed', listener)

    return () => ipcRenderer.removeListener('scout:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('scout:focus-session', listener)

    return () => ipcRenderer.removeListener('scout:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('scout:notification-action', listener)

    return () => ipcRenderer.removeListener('scout:notification-action', listener)
  },
  onNotificationActivate: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('scout:notification-activate', listener)

    return () => ipcRenderer.removeListener('scout:notification-activate', listener)
  },
  onExternalOpenFailed: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('scout:external-open-failed', listener)

    return () => ipcRenderer.removeListener('scout:external-open-failed', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('scout:preview-file-changed', listener)

    return () => ipcRenderer.removeListener('scout:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('scout:backend-exit', listener)

    return () => ipcRenderer.removeListener('scout:backend-exit', listener)
  },
  // Cooperative pool retirement (main → renderer): the pooled backend under
  // `poolKey` is being stopped for a foreground open. Park that scope; do not
  // redial into the slot it vacated.
  onPoolBackendRetiring: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('scout:pool:retiring', listener)

    return () => ipcRenderer.removeListener('scout:pool:retiring', listener)
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: callback => {
    const listener = () => callback()
    ipcRenderer.on('scout:connection:applied', listener)

    return () => ipcRenderer.removeListener('scout:connection:applied', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('scout:power-resume', listener)

    return () => ipcRenderer.removeListener('scout:power-resume', listener)
  },
  // AC ↔ battery transitions; renderers slow their backstop polls on battery.
  getOnBattery: () => ipcRenderer.invoke('scout:power-battery:get'),
  onBatteryChanged: callback => {
    const listener = (_event, onBattery) => callback(Boolean(onBattery))
    ipcRenderer.on('scout:power-battery', listener)

    return () => ipcRenderer.removeListener('scout:power-battery', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('scout:boot-progress', listener)

    return () => ipcRenderer.removeListener('scout:boot-progress', listener)
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.ts (apps/desktop/electron/bootstrap-runner.ts).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => ipcRenderer.invoke('scout:bootstrap:get'),
  probeLocalBackend: () => ipcRenderer.invoke('scout:local-backend:probe'),
  continueBootstrapLocal: () => ipcRenderer.invoke('scout:bootstrap:continue-local'),
  recycleBackend: profile => ipcRenderer.invoke('scout:backend:recycle', profile),
  resetBootstrap: () => ipcRenderer.invoke('scout:bootstrap:reset'),
  repairBootstrap: () => ipcRenderer.invoke('scout:bootstrap:repair'),
  cancelBootstrap: () => ipcRenderer.invoke('scout:bootstrap:cancel'),
  onBootstrapEvent: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('scout:bootstrap:event', listener)

    return () => ipcRenderer.removeListener('scout:bootstrap:event', listener)
  },
  getVersion: () => ipcRenderer.invoke('scout:version'),
  relaunchApp: () => ipcRenderer.invoke('scout:app:relaunch'),
  getMachineProfile: () => ipcRenderer.invoke('scout:machine:profile'),
  getRemoteDisplayReason: () => ipcRenderer.invoke('scout:get-remote-display-reason'),
  uninstall: {
    summary: () => ipcRenderer.invoke('scout:uninstall:summary'),
    run: mode => ipcRenderer.invoke('scout:uninstall:run', { mode })
  },
  updates: {
    check: opts => ipcRenderer.invoke('scout:updates:check', opts),
    apply: opts => ipcRenderer.invoke('scout:updates:apply', opts),
    getBranch: () => ipcRenderer.invoke('scout:updates:branch:get'),
    setBranch: name => ipcRenderer.invoke('scout:updates:branch:set', name),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('scout:updates:progress', listener)

      return () => ipcRenderer.removeListener('scout:updates:progress', listener)
    },
    takePendingRun: () => ipcRenderer.invoke('scout:updates:metric:take'),
    ackPendingRun: sent => ipcRenderer.invoke('scout:updates:metric:ack', sent),
    onPendingRun: callback => {
      const listener = () => callback()
      ipcRenderer.on('scout:updates:metric:pending', listener)

      return () => ipcRenderer.removeListener('scout:updates:metric:pending', listener)
    }
  },
  desktopMetrics: {
    setEnabled: (on, profile) => ipcRenderer.invoke('scout:desktop-metrics:set-enabled', on, profile),
    takeRendererCrashes: () => ipcRenderer.invoke('scout:desktop-metrics:crash:take'),
    ackRendererCrashes: sent => ipcRenderer.invoke('scout:desktop-metrics:crash:ack', sent)
  },
  themes: {
    fetchMarketplace: id => ipcRenderer.invoke('scout:vscode-theme:fetch', id),
    searchMarketplace: query => ipcRenderer.invoke('scout:vscode-theme:search', query)
  },
  // Find-in-page (Ctrl/Cmd+F): delegates to Electron's
  // webContents.findInPage on the IPC sender's window so a Cmd+F pressed
  // in a secondary session window searches THAT window, not the primary.
  // `onFoundInPage` returns the unsubscribe fn; the renderer wires it via
  // `initFindInPageListener` in store/find-in-page.ts and tears it down
  // when the FindBar unmounts.
  findInPage: (query, options) => ipcRenderer.invoke('scout:find-in-page', query, options),
  stopFindInPage: () => ipcRenderer.invoke('scout:stop-find-in-page'),
  onFoundInPage: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('scout:found-in-page', listener)

    return () => ipcRenderer.removeListener('scout:found-in-page', listener)
  },
  // Main-process `before-input-event` forwards Ctrl/Cmd+F here so renderer
  // can open the FindBar even when the GTK compositor has already grabbed
  // the chord at the windowing layer (#81727).
  onOpenFindBarRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('scout:open-find-bar', listener)

    return () => ipcRenderer.removeListener('scout:open-find-bar', listener)
  }
})
