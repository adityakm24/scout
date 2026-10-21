import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import { pathToFileURL } from 'node:url'

import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  net as electronNet,
  webContents as electronWebContents,
  globalShortcut,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  Menu,
  type MenuItemConstructorOptions,
  nativeTheme,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences
} from 'electron'
import type { Session } from 'electron'

import { type ActiveRuntimeState, classifyActiveRuntime } from './active-runtime-state'
import {
  destroyKeepaliveAgents,
  htmlResponseError,
  httpStatusError,
  jsonAgentFor,
  readStatusCode,
  withRetry
} from './api-transport'
import { appIconCandidates, resolveAppIcon, shouldOverrideDockIcon } from './app-icon'
import { stageAppInstallerFile } from './app-installer-file'
import {
  appVersionInfo,
  type AppVersionInfo,
  assertSourceUpdateChannel,
  nativeAboutVersion,
  packagedReleaseChannel
} from './app-version'
import { runAppInstallerChecker } from './appinstaller-checker'
import { installApplicationMenuAfterFirstWindow } from './application-menu-startup'
import { stopBackendChild as stopBackendChildImpl, waitForBackendExit } from './backend-child'
import { execText } from './backend-claim'
import { createBackendConnectionState } from './backend-connection-state'
import { BackendDialClaims } from './backend-dial-claim'
import { buildDesktopBackendEnv } from './backend-env'
import { isReauthRequiredError, waitForScoutReady } from './backend-health'
import { createBackendShutdownCoordinator } from './backend-ownership'
import { canImportScoutCli, PROBE_TIMEOUT_MS, shouldTrustScoutOverride, verifyScoutCli } from './backend-probes'
import { isPidAliveWindows, waitForBackendRelease } from './backend-release-gate'
import { createInstalledRuntimeGate } from './backend-resolution'
import { shouldHoldBootProgressForReauth } from './backend-start-failure'
import {
  detectRemoteDisplay,
  isWindowsBinaryPathInWsl,
  isWslEnvironment,
  resolveLinuxPasswordStore
} from './bootstrap-platform'
import {
  BROWSER_WINDOW_HEIGHT,
  BROWSER_WINDOW_MIN_HEIGHT,
  BROWSER_WINDOW_MIN_WIDTH,
  BROWSER_WINDOW_WIDTH,
  buildBrowserWindowUrl
} from './browser-windows'
import { detectBundleSkew } from './bundle-skew'
import { detectBundleSwap, readBundleSwapStamp } from './bundle-swap'
import { registerChatOnboardingWindow } from './chat-onboarding-window'
import { provisionCliLinks } from './cli-provision'
import { installCommandScreenshot } from './command-screenshot'
import { composerImageTimestamp } from './composer-image-name'
import { writeComposerPaste } from './composer-paste'
import { connectionInstallIds, rosterSourceErrors, sshRosterCache } from './connection-caches'
import { apiRequestRegistryConnectionId, buildGatewayWsUrl, buildGatewayWsUrlWithTicket, cookiesHaveSession, gatewayWsUrlIpcResult, hostLabelFromBaseUrl, isGatewayAuthRejection, modeIsRemoteLike, normalizeRemoteBaseUrl, normalizeRemoteHeaders, pathForRegistryBackendRequest, pathWithGlobalRemoteProfile, type ProfileRouteOptions, type RegistryBackendRequestScope, resolveProfileApiRequest, resolveProfileBackendRoute, sanitizeRemoteHeaderValue, withTransientRetries } from './connection-config'
import { backendScopeKey, buildAgentRoster, registryDialConnectionId, rememberSshEnumeration, resolvedConnectionId } from './connection-registry'
import type { RosterProfileMetadata } from './connection-registry'
import { liveWindowState, overlayWindowState } from './connection-window-state'
import { describeCrashReason, installCrashForensics } from './crash-forensics'
import { resolveServedDashboardToken } from './dashboard-token'
import { resolveDesktopScoutHome, resolveDesktopUserData } from './data-paths'
import { formatDesktopLogLine, formatLogStamp } from './desktop-log-line'
import {
  createDesktopProfilePreferences,
  DESKTOP_PROFILE_NAME_RE,
  type DesktopProfileRoute,
  resolveDesktopConnectionRequest,
  resolveDesktopWindowLaunch
} from './desktop-profile'
import {
  buildPosixCleanupScript,
  buildWindowsCleanupScript,
  type DesktopUninstallResult,
  modeRemovesAgent,
  modeRemovesUserData,
  registerDesktopUninstallIpc,
  resolveRemovableAppPath,
  shouldRemoveAppBundle,
  uninstallArgsForMode,
  type UninstallSummaryDetails
} from './desktop-uninstall'
import { describeDevCdpDecision, resolveDevCdpPort } from './dev-cdp'
import { preReadyDockLaunchSteps } from './dock-launch-order'
import { installEmbedReferer } from './embed-referer'
import { createAmbientClaimArbiter } from './event-dedupe'
import { openExternalUrl as externalOpen, type ExternalOpenDeps, reportPreOpenStatFailure } from './external-open'
import { f12ShortcutDecision, toF12KeyboardEventPayload } from './f12-shortcut'
import { type FaviconIo, resolveFavicon } from './favicon'
import { resolveFeatureFlags } from './feature-flags'
import {
  installFindShortcut,
  installFoundInPageForwarder,
  performFindAfterIndexingStarted,
  stopFind
} from './find-in-page'
import { registerFsIpc } from './fs-ipc'
import type {
  GatewayFileSaveContext,
  GatewayFileSaveDeps,
  GatewayFileSaveResult,
  GatewaySaveDialogOptions,
  GatewaySaveDialogResult
} from './gateway-file-download'
import {
  gatewayFilePath,
  gatewayFileRequestPaths,
  resolveGatewayFileBackend,
  saveGatewayDownload
} from './gateway-file-download'
import { downloadViaOauthSessionToFile, downloadViaTokenToFile } from './gateway-file-download-transport'
import { stopGatewayBeforeUpdate } from './gateway-stop-before-update'
import { resolveGatewayVersion } from './gateway-version'
import { windowsGitCandidates } from './git-binary-candidates'
import { registerGitIpc } from './git-ipc'
import { guestOnboardingEnabled } from './guest-onboarding'
import { assertExistingPathForOpen, ATTACHMENT_UPLOAD_DEFAULT_MAX_BYTES, clampDataUrlReadMaxMb, DATA_URL_READ_DEFAULT_MAX_MB, dataUrlReadMaxBytesFromMb, DEFAULT_FETCH_TIMEOUT_MS, enableBasicPasswordStoreEncryption, encryptDesktopSecret as encryptDesktopSecretStrict, homeRelativeAttachmentCandidates, readFileDataUrlForIpc, resolveReadableFileForIpc, resolveRequestedPathForIpc, resolveTimeoutMs, SAFE_STORAGE_ENCODING, TEXT_PREVIEW_SOURCE_MAX_BYTES, writeSecretFileAtomic } from './hardening'
import { createPrimaryRemoteConnection, HOSTED_BACKEND_URL, hostedConnectionsRegistry } from './hosted-backend'
import { requestHudClose } from './hud-close'
import { cursorPointInWindow } from './hud-cursor'
import { startHudGameOverlayWatch } from './hud-game-overlay'
import { applyHudResetBounds, defaultHudBounds } from './hud-geometry'
import { registerHudIpc } from './hud-ipc'
import { installHudModifierTap } from './hud-modifier'
import { applyHudElectronOverlay, promoteHudOverlay } from './hud-overlay'
import { snapHudBounds } from './hud-snap'
import { createHudSnapShortcut } from './hud-snap-shortcut'
import { buildHudWindowUrl } from './hud-url'
import { resolveHudWindowing } from './hud-windowing'
import { INSTALL_STAMP } from './install-stamp'
import type { InstallStamp } from './install-stamp'
import { applyLaunchProfileOverride } from './launch-profile'
import { CURL_TITLE_WRITE_OUT, parseCurlTitleResponse } from './link-title-curl'
import { canonicalTitleCacheKey, isFetchableHttpUrl } from './link-title-url'
import { isAuthWall, resolveLinkTitle } from './link-title-wall'
import { createLinkTitleWindow, guardLinkTitleSession, readLinkTitleWindowTitle } from './link-title-window'
import { CHROMIUM_LOG_FILENAME, enableLinuxCrashDiagnostics, linuxCrashDiagnostics } from './linux-crash-diagnostics'
import { notifyLauncherWindowRevealed } from './linux-launcher-ready'
import { decideNvidiaEglFallback, parseNvidiaDriverMajor } from './linux-nvidia-egl-fallback'
import { waitForTeardown } from './local-backend-lifecycle'
import { resolveIpcFileReadPath, resolveMediaStreamFile, resolvePreviewTargetPath } from './local-read-path'
import { localSkinProfileKey, readLocalSkinPayload } from './local-skin'
import { ACTIVE_LOG_POLL_MS, planLogRotation, reclaimActiveLogIfOversized } from './log-rotation'
import { registerMachineProfile } from './machine-profile'
import { createMainProcessLagWatchdog } from './main-process-lag-watchdog'
import { ensureMainWindow } from './main-window-lifecycle'
import { registerMcpOauthCallbackIpc } from './mcp-oauth-callback-ipc'
import { createMediaProtocolHandler, MEDIA_PROTOCOL } from './media-protocol'
import { fetchLocalMedia } from './media-range'
import { createMinimizeToTray } from './minimize-to-tray'
import {
  createNativeAccessTokenCoordinator,
  type NativeAccessTokenOptions,
  NativeAuthChangedError
} from './native-access-token'
import { resolveJsonBody, resolveReadinessProbeAuth } from './native-auth-decisions'
import { nativeRefreshUrl, type NativeTokenSet, parseTokenResponse, tokenNeedsRefresh } from './native-oauth'
import { loadNativeTokenSet, type NativeTokenStoreIo, persistNativeTokenSet } from './native-token-store'
import { planNoConsoleGitSpawn, setNoConsoleGitRoots, windowsGitHost } from './no-console-git'
import { registerNativeNotifications } from './notification-ipc'
import { isExpectedOauthNavigationAbort } from './oauth-navigation'
import { serializeJsonBody, setJsonRequestHeaders } from './oauth-net-request'
import { LEGACY_OAUTH_PARTITION, resolveOauthPartition } from './oauth-partition'
import {
  canShowInteractiveOauthLogin,
  mintGatewayWsTicket as mintOauthGatewayWsTicket,
  requestWithOauthFallback,
  retryCookie401WithLogin,
  withoutInteractiveOauthLogin
} from './oauth-rest-request'
import { wireOauthSessionResponse } from './oauth-session-response'
import { bundledPayload, installIdForRoot, type PayloadInfo } from './payload-backend'
import { petOverlayClickThrough } from './pet-overlay'
import { placePetOverlay, registerPetOverlayIpc } from './pet-overlay-ipc'
import {
  buildRegistryProfileRoutes,
  isLocalEnumerationFailure,
  localRouteFallbackProfiles,
  undialedSshRouteSeeds
} from './plugin-profile-routes'
import { type LocalBackendSpawnPriority } from './pool-spawn-coordinator'
import { createKeepAwake } from './power-save'
import { readPreUpdateBackupEnabled } from './pre-update-backup-config'
import { capturePreviewContents } from './preview-capture'
import { onPreviewWatchOwnerDestroyed, sendPreviewFileChangedToOwner } from './preview-file-watch'
import type { PreviewReachRegistry } from './preview-reach'
import { PrimaryProfilePin, resolveLaunchProfile } from './primary-profile-pin'
import { applyDesktopIdentity, PRODUCT_IDENTITY } from './product-identity'
import { decideProfileDeleteAction, dispatchConnectionScopedProfileDelete, ProfileDeletionGate, profileNameFromDeleteRequest, resolveRouteProfile } from './profile-delete-routing'
import { migrateActiveProfileIfMissing as migrateActiveProfileIfMissingPure } from './profile-migration'
import { prepareProfileRenameLifecycle, profileRenameFromRequest } from './profile-rename-routing'
import { tagRegistrySessionResponse } from './profile-session-routing'
import { createQuickEntryShortcut, quickEntryWindowBounds, sanitizeQuickEntrySettings } from './quick-entry'
import { createQuitFinalization } from './quit-finalization'
import { type ActiveWork, mergeActiveWork, normalizeActiveWork, quitPromptFor } from './quit-guard'
import {
  backendQuitNeedsWait,
  backendTeardownOptions,
  createQuitTeardownCoordinator,
  type QuitTeardownTask
} from './quit-teardown'
import { RemoteLivenessTracker, RemoteRevalidationCoordinator, revalidateRemoteConnection } from './remote-liveness'
import { resolveRemoteOauthTicket, rosterSourceEnumerationTimeoutMs } from './remote-oauth-ticket'
import { remoteSessionCookies } from './remote-session-cookies'
import {
  attachRemoteRequestHeaderListener,
  collectRemoteHeaderSources,
  createRegistryGatewayWsUrlHandler,
  createRemoteWsHeaderStore,
  oauthLoginLoadUrlOptions,
  resolveRemoteRequestHeaders
} from './remote-ws-headers'
import { enableRendererAccessibility } from './renderer-accessibility'
import { missingRendererAssets, presentRendererIndexes } from './renderer-bundle'
import { planLaunchSwitches, readDesktopLaunchConfig } from './renderer-heap-flags'
import { loadRendererLoadErrorPage } from './renderer-load-error-page'
import { attachRendererConsoleCapture, formatRendererBoundaryReport } from './renderer-log'
import { fetchRosterSourceData } from './roster-source-fetch'
import { rosterSourceStatus } from './roster-source-status'
import {
  classifyStoredSecret,
  readSecretStoragePolicy,
  SECRET_STORAGE_POLICY_FILE,
  type SecretStoragePolicy,
  writeSecretStoragePolicy
} from './secret-storage-policy'
import { selectPathsDialogProperties } from './select-paths-dialog'
import { describeGitSpawnFailure, GIT_UNUSABLE, selectRunnableBinary } from './select-runnable-binary'
import {
  buildInstanceWindowUrl,
  buildSessionWindowUrl,
  chatWindowWebPreferences,
  createSessionWindowRegistry,
  instanceWindowBounds,
  SESSION_WINDOW_MIN_HEIGHT,
  SESSION_WINDOW_MIN_WIDTH
} from './session-windows'
import { ensureLoginShellPath } from './shell-path'
import { createSourcePythonBackend, resolveSourceInstallationBackend, type SourceBackend } from './source-backend'
import { resolveSourcePython } from './source-python'
import { redactSecrets } from './ssh-connection'
import { createStreamThrottle } from './stream-throttle'
import { installSystemCaTrust } from './system-ca'
import { nativeOverlayWidth as computeNativeOverlayWidth, titleBarOverlayOptions } from './titlebar-overlay-width'
import {
  backgroundMaterialFor,
  defaultTranslucencyState,
  glassActive,
  glassSupportedOn,
  normalizeState as normalizeTranslucency,
  opacityNeedsSetting,
  translucencySupportedOn,
  vibrancyFor as vibrancyForTranslucency,
  windowBackingOptions,
  windowOpacityFor,
  windowOpacityOptions
} from './translucency'
import {
  resolveUpdaterMechanism,
  type UpdaterApplyResultWire,
  type UpdaterStatusWire,
  type UpdaterStrategy
} from './updater'
import { resolveInstallationLauncher, resolveStagedUpdaterBinary, resolveVenvDir } from './updater-process'
import { AppInstallerStrategy } from './updater/app-installer'
import { createChannelAppInstallerStrategy } from './updater/app-installer'
import { ChannelResolver, type ChannelTarget } from './updater/channel'
import { inspectRunningChannelApp } from './updater/channel-native'
import { ChannelStrategy } from './updater/channel-strategy'
import { verifyPreparedChannelInstaller } from './updater/channel-windows-host'
import { createCheckoutStrategy } from './updater/checkout'
import { readSourceUpdate, type SourceUpdate } from './updater/checkout-source'
import { ExternalStrategy } from './updater/external'
import { readUpdatesFeedBaseFromConfig, resolveFeedBaseUrl } from './updater/feed-config'
import { createChannelMacStrategy, createMacStrategy } from './updater/mac-client'
import { UpdateOperation } from './updater/operation'
import {
  type ConsumedRelaunch,
  consumePendingRelaunch,
  registerUpdateRelaunch,
  type RelaunchRegistration
} from './updater/relaunch'
import { startRelaunchWaiter } from './updater/relaunch-waiter'
import { preflightStateDb } from './updater/state-db-preflight'
import { createStoreStrategy } from './updater/store-client'
import { isExternalVenvHolder, isScoutOwnedVenvDaemon } from './venv-holder-select'
import { fetchMarketplaceThemes, searchMarketplaceThemes } from './vscode-marketplace'
import { decodeWebText } from './web-text-decoder'
import { windowAcceleratorAction } from './window-accelerator'
import { enumerateWindowsFrontToBack, enumerationFailed, readWindowBelow } from './window-below'
import { bindWindowChromeEvents } from './window-chrome-events'
import { WindowConnectionRouteRegistry } from './window-connection-route'
import { registerWindowControlIpc, windowControlState } from './window-controls'
import { createWindowOpenHandler } from './window-open-policy'
import { installWindowRendererLifecycle } from './window-renderer-lifecycle'
import { wireWindowReveal } from './window-reveal'
import {
  bindGeometryPersistence,
  computeWindowOptions,
  debounce,
  firstLaunchSize,
  sanitizeWindowState,
  MIN_HEIGHT as WINDOW_MIN_HEIGHT,
  MIN_WIDTH as WINDOW_MIN_WIDTH
} from './window-state'
import { hiddenWindowsChildOptions } from './windows-child-options'
import {
  alreadyHasNoSandbox,
  buildNoSandboxRelaunchArgs,
  decideWindowsSandboxLaunch,
  fallbackMarker,
  grantAllApplicationPackagesAcl,
  markerAfterSuccessfulBoot,
  readSandboxMarker,
  type SandboxFallbackReason,
  shouldAttemptAclRepair,
  shouldRelaunchForGpuSandboxCrash,
  shouldRelaunchForRendererSandboxCrashLoop,
  writeSandboxMarker
} from './windows-sandbox-fallback'
import { buildPathExtCandidates, resolveVenvScoutCommand } from './windows-scout-path'
import {
  alreadyHasDisableGpu,
  buildDisableGpuRelaunchArgs,
  decideWindowsGpuStackCookieLaunch,
  gpuStackCookieFallbackMarker,
  isScoutDesktopGpuOverrideOff,
  markerAfterSuccessfulGpuStackCookieBoot,
  readGpuStackCookieMarker,
  shouldRelaunchForRendererStackCookieCrashLoop,
  shouldSurfaceErrorForRendererStackCookieCrashLoop,
  writeGpuStackCookieMarker
} from './windows-stack-cookie-fallback'
import { readWindowsUserEnvVar } from './windows-user-env'
import { isPackagedInstallPath as isPackagedInstallPathUnderRoots } from './workspace-cwd'
import { readWslWindowsClipboardImage } from './wsl-clipboard-image'
import { resolvePickerDefaultPath, setActiveGatewayProfile, setWslBridgeProfileState } from './wsl-path-bridge'

const IDENTITY_APP_NAME: string | null = applyDesktopIdentity(app)
const USER_DATA_OVERRIDE: string | undefined = process.env.SCOUT_DESKTOP_USER_DATA_DIR

if (USER_DATA_OVERRIDE || process.env.SCOUT_DATA_DIR_SUFFIX) {
  const resolvedUserData: string = resolveDesktopUserData(app.getPath('userData'))
  fs.mkdirSync(resolvedUserData, { recursive: true })
  app.setPath('userData', resolvedUserData)
}

const DEV_SERVER = process.env.SCOUT_DESKTOP_DEV_SERVER
const IS_PACKAGED = app.isPackaged || Boolean(process.env.SCOUT_DESKTOP_IS_PACKAGED)
const IS_MAC = process.platform === 'darwin'
const IS_WINDOWS = process.platform === 'win32'
const IS_WSL = isWslEnvironment()
// Truthful macOS kernel major (Tahoe = 25). Product version lies (16 vs 26) per
// build SDK, so gate Tahoe workarounds on Darwin instead.
const DARWIN_MAJOR = IS_MAC ? Number.parseInt(os.release(), 10) || 0 : 0
// Glass: macOS vibrancy, or Windows 11 22H2+ system backdrop. Computed once
// so the renderer, the persisted default, and every chat window agree.
const GLASS_SUPPORTED = glassSupportedOn(process.platform, os.release())
// Clear rides setOpacity, a documented no-op on Linux, so neither mode works
// there and Settings drops the row entirely.
const TRANSLUCENCY_SUPPORTED = translucencySupportedOn(process.platform)
const APP_ROOT = app.getAppPath()

// Device-local preference: block F12 from opening DevTools.
// Set dynamically via IPC from the renderer Settings → Advanced.
let f12Blocked = false

// Preload must be plain JS — Electron's sandbox can't run .ts, and tsx's
// ESM loader is broken on Electron 40's Node (ERR_INVALID_RETURN_PROPERTY_VALUE).
// Dev (`npm run dev`) and prod both load the esbuild output from dist/.
const PRELOAD_PATH = path.join(APP_ROOT, 'dist', 'electron-preload.js')
const PREVIEW_GUEST_PRELOAD_PATH = path.join(APP_ROOT, 'dist', 'preview-guest-preload.js')

// Remote displays (SSH X11 forwarding, VNC, RDP) make Chromium's GPU
// compositor flicker — accelerated layers can't be presented cleanly over the
// wire, so the window flashes during scroll/streaming/animation. Local
// Windows/macOS (and WSLg, which renders locally via vGPU) composite on the
// GPU and never see it. Fall back to software rendering when a remote display
// is detected; it's rock-steady over the wire and the CPU cost is negligible
// next to the connection's latency. Must run before app `ready` — these
// switches only apply pre-launch. Override with SCOUT_DESKTOP_DISABLE_GPU
// (1/true → always disable, 0/false → keep GPU on).
const REMOTE_DISPLAY_REASON = detectRemoteDisplay()

if (REMOTE_DISPLAY_REASON) {
  app.disableHardwareAcceleration()
  // Belt-and-suspenders for X11/VNC, where the Viz compositor can still glitch
  // with only --disable-gpu: force compositing onto the CPU too.
  app.commandLine.appendSwitch('disable-gpu-compositing')
  console.log(
    `[scout] remote display detected (${REMOTE_DISPLAY_REASON}); disabling GPU hardware acceleration to prevent flicker`
  )
}

// #108047: a local Windows renderer crash loop with STATUS_STACK_BUFFER_OVERRUN
// (0xC0000409) is recovered by disabling GPU — NOT by dropping the sandbox
// (that path stays owned by STATUS_BREAKPOINT / #38216). Must run before app
// `ready`. Skip applying switches when the remote-display block above already
// did; still honor a sticky per-version marker so Start Menu launches recover.
let windowsGpuStackCookieFallbackActive = false
let windowsGpuStackCookieFallbackSticky = false
let windowsGpuStackCookieRelaunchAttempted = false

if (IS_WINDOWS) {
  const windowsGpuUserData = app.getPath('userData')

  const gpuStackCookieDecision = decideWindowsGpuStackCookieLaunch({
    argv: process.argv,
    marker: readGpuStackCookieMarker(windowsGpuUserData),
    env: process.env,
    appVersion: app.getVersion()
  })

  windowsGpuStackCookieFallbackActive = gpuStackCookieDecision.enable
  windowsGpuStackCookieFallbackSticky = gpuStackCookieDecision.nextMarker.state === 'fallback'

  try {
    writeGpuStackCookieMarker(windowsGpuUserData, gpuStackCookieDecision.nextMarker)
  } catch {
    void 0
  }

  if (gpuStackCookieDecision.enable && !REMOTE_DISPLAY_REASON) {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('disable-gpu-compositing')
    console.log(
      `[scout] Windows GPU stack-cookie fallback enabled (${gpuStackCookieDecision.reason}); disabling GPU hardware acceleration (0xC0000409 / #108047)`
    )
  }
}

// Renderer debugging port. On for dev-server runs (`hgui` / `npm run dev`) so
// the CDP tooling in scripts/ can attach; never for a packaged build — see
// electron/dev-cdp.ts. Must run before app `ready` like the switches above;
// Chromium binds it at launch.
const DEV_CDP = resolveDevCdpPort({ env: process.env, isPackaged: IS_PACKAGED, devServer: DEV_SERVER })

if (DEV_CDP.port) {
  app.commandLine.appendSwitch('remote-debugging-port', String(DEV_CDP.port))
  // Loopback only. Chromium already defaults to 127.0.0.1, but say it out loud
  // so a future edit can't widen it by omission.
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
  console.log(
    `[scout] renderer debugging on http://127.0.0.1:${DEV_CDP.port} — anything that can reach it ` +
      'can run code in the renderer. SCOUT_DESKTOP_CDP_PORT=off to disable.'
  )
} else {
  const why = describeDevCdpDecision(DEV_CDP)

  if (why) {
    console.warn(`[scout] ${why}`)
  }
}

// WSLg: Chromium blocklists the Mesa vGPU → software compositing → typing lag.
// /dev/dxg means a real GPU is available; un-blocklist it. Skipped when a remote
// display already forced software (SSH'd-into-WSL).
if (IS_WSL && !REMOTE_DISPLAY_REASON && fs.existsSync('/dev/dxg')) {
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')
  console.log('[scout] WSL GPU passthrough (/dev/dxg) detected; enabling GPU acceleration')
}

// #40077: NVIDIA driver 580.x breaks ANGLE's EGL probing (Invalid visual ID),
// killing the GPU process at startup. Route ANGLE through its SwiftShader
// backend instead — the app then launches and stays up (CPU rendering, slow
// but stable). Deliberately NOT disableHardwareAcceleration(): on 580.173.02 +
// Electron 40 that SIGKILLs the renderer (see the closed #40119). Must run
// before app `ready` — the switch only applies pre-launch. Override with
// SCOUT_DESKTOP_NVIDIA_SWIFTSHADER (1/true → force on, 0/false → never).
const NVIDIA_EGL_FALLBACK = decideNvidiaEglFallback({
  driverMajor: parseNvidiaDriverMajor(
    (() => {
      try {
        return fs.readFileSync('/proc/driver/nvidia/version', 'utf8')
      } catch {
        return ''
      }
    })()
  ),
  env: process.env,
  platform: process.platform,
  isWsl: IS_WSL,
  remoteDisplayReason: REMOTE_DISPLAY_REASON
})

if (NVIDIA_EGL_FALLBACK.enable) {
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
  console.log(
    `[scout] NVIDIA EGL fallback enabled (${NVIDIA_EGL_FALLBACK.reason}); routing ANGLE ` +
      'through SwiftShader to avoid the NVIDIA 580-series EGL probe crash (#40077). ' +
      'SCOUT_DESKTOP_NVIDIA_SWIFTSHADER=0 to opt out.'
  )
}

// Linux: point Chromium at the session's keychain backend so safeStorage can
// encrypt remote gateway tokens (hardening.ts refuses to persist them without
// it). The value arrives via SCOUT_DESKTOP_PASSWORD_STORE, bridged by the
// `scout desktop` launcher from detection or `desktop.password_store` in
// config.yaml. Must run before app `ready` — the switch only applies pre-launch.
const PASSWORD_STORE = resolveLinuxPasswordStore()

if (PASSWORD_STORE.warning) {
  console.warn(`[scout] ${PASSWORD_STORE.warning}`)
}

if (PASSWORD_STORE.store) {
  app.commandLine.appendSwitch('password-store', PASSWORD_STORE.store)
  console.log(`[scout] using password-store backend: ${PASSWORD_STORE.store}`)
}

// Windows sandbox / GPU breakpoint crash recovery (#38216).
//
// Some hosts (AMD RX 6000 drivers, orphan AppContainer SIDs under %LOCALAPPDATA%,
// missing S-1-15-2-2 ACEs) kill Chromium's sandboxed GPU/renderer children with
// 0x80000003. After enough GPU deaths the browser process FATAL-exits before the
// UI is usable. Must run before app `ready` so `--no-sandbox` applies to child
// processes. The sticky marker recovers Start Menu / shortcut launches that
// never go through `scout desktop`; it is version-scoped so an app update
// re-probes the sandbox instead of degrading forever.
//
// `windowsSandboxFallbackActive` = this process runs without the Chromium
// sandbox (any cause, including a manual --no-sandbox flag) — guards the
// relaunch handlers. `windowsSandboxFallbackSticky` = the fallback machinery
// engaged and the marker must stay `fallback` after a successful boot; a
// manual flag alone is honored but never made sticky.
let windowsSandboxFallbackActive = false
let windowsSandboxFallbackSticky = false
let windowsSandboxFallbackReason: SandboxFallbackReason = 'boot-loop'
let windowsNoSandboxRelaunchAttempted = false

if (IS_WINDOWS) {
  const windowsUserData = app.getPath('userData')
  const priorMarker = readSandboxMarker(windowsUserData)

  // Best-effort ACL repair, only when the last boot aborted or the fallback is
  // engaged — icacls /T recurses the whole install tree, so healthy launches
  // skip it (the installer already granted the ACE at install time). Repair
  // targets the install dir only: granting AppContainer read on userData would
  // expose Scout sessions/config to every packaged app on the machine.
  if (shouldAttemptAclRepair(priorMarker)) {
    const exeDir = path.dirname(process.execPath)
    const acl = grantAllApplicationPackagesAcl(exeDir, { execFileSync })

    if (acl.ok) {
      console.log(`[scout] granted ALL APPLICATION PACKAGES RX on ${exeDir} (#38216)`)
    } else if (acl.error && acl.error !== 'missing-target-or-exec') {
      console.warn(`[scout] AppContainer ACL grant failed on ${exeDir}: ${acl.error}`)
    }
  }

  const sandboxDecision = decideWindowsSandboxLaunch({
    argv: process.argv,
    env: process.env,
    marker: priorMarker,
    appVersion: app.getVersion()
  })

  windowsSandboxFallbackActive = sandboxDecision.enable
  windowsSandboxFallbackSticky = sandboxDecision.nextMarker.state === 'fallback'

  if (sandboxDecision.nextMarker.state === 'fallback' && sandboxDecision.nextMarker.reason) {
    windowsSandboxFallbackReason = sandboxDecision.nextMarker.reason
  }

  if (sandboxDecision.enable && sandboxDecision.reason !== 'already-enabled') {
    app.commandLine.appendSwitch('no-sandbox')
    process.env.ELECTRON_DISABLE_SANDBOX = '1'
    console.log(
      `[scout] Windows sandbox fallback enabled (${sandboxDecision.reason}); launching with --no-sandbox (#38216)`
    )
  }

  writeSandboxMarker(windowsUserData, sandboxDecision.nextMarker)

  // Catch the first GPU breakpoint death and relaunch before Chromium's
  // "GPU process isn't usable" FATAL abort ends the process with no recovery.
  app.on('child-process-gone', (_event, details) => {
    if (
      !shouldRelaunchForGpuSandboxCrash({
        details,
        alreadyNoSandbox: windowsSandboxFallbackActive || alreadyHasNoSandbox(process.argv, process.env),
        relaunchAttempted: windowsNoSandboxRelaunchAttempted
      })
    ) {
      return
    }

    windowsNoSandboxRelaunchAttempted = true
    windowsSandboxFallbackActive = true
    windowsSandboxFallbackSticky = true
    windowsSandboxFallbackReason = 'gpu-breakpoint'

    try {
      writeSandboxMarker(app.getPath('userData'), fallbackMarker('gpu-breakpoint', app.getVersion()))
    } catch {
      void 0
    }

    console.warn(
      `[scout] Windows GPU sandbox crashed (exit=${details?.exitCode}); relaunching once with --no-sandbox (#38216)`
    )

    try {
      app.relaunch({ args: buildNoSandboxRelaunchArgs(process.argv.slice(1)) })
      void exitAfterBackendShutdown(0)
    } catch (error) {
      console.error(`[scout] --no-sandbox relaunch failed: ${error?.message || error}`)
    }
  })
}

ipcMain.handle('scout:get-remote-display-reason', () => REMOTE_DISPLAY_REASON)

// Keep the renderer's PROCESS priority normal while its windows are hidden —
// a deprioritized renderer streams a live answer visibly slower once the
// window is minimized. This switch only affects scheduling priority; it does
// not exempt timers from throttling and costs nothing at idle.
//
// The timer/rAF throttling story is deliberately NOT handled here anymore.
// The old process-wide `disable-background-timer-throttling` /
// `disable-backgrounding-occluded-windows` switches (plus a static
// `backgroundThrottling: false` on every chat window) pinned every renderer's
// `document.visibilityState` to 'visible' forever — which silently turned all
// the renderer's visibility-gated backstop polls and clock ticks into
// always-on timers. A completely idle, minimized Scout burned ~20% CPU
// around the clock. Throttling is now a runtime dial scoped to streaming:
// see createStreamThrottle() — chat windows are unthrottled while any turn is
// in flight (so a live answer keeps painting while blurred, occluded, or
// minimized, exactly as before) and return to Chromium's default throttling
// once the work settles.
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const SOURCE_REPO_ROOT = path.resolve(APP_ROOT, '../..')

// Runtime identity comes only from the baked artifact stamp. Dev runs have none.
if (INSTALL_STAMP) {
  console.log(
    `[scout] install stamp: ${INSTALL_STAMP.commit ? INSTALL_STAMP.commit.slice(0, 12) : 'no-commit'}${INSTALL_STAMP.branch ? ` (${INSTALL_STAMP.branch})` : ''}${INSTALL_STAMP.dirty ? ' [DIRTY]' : ''} from ${INSTALL_STAMP.source || 'unknown'}`
  )
} else if (IS_PACKAGED) {
  // Dev builds without a stamp are normal; packaged builds without one
  // mean the bootstrap won't know what to clone. Surface clearly.
  console.error(
    '[scout] WARNING: no install-stamp.json found in packaged build. First-launch bootstrap will not have a pinned ref to install.'
  )
}

const DESKTOP_PROFILE_CONFIG_PATH: string = path.join(app.getPath('userData'), 'active-profile.json')
// Only the lock-owning destination may adopt a workspace or start a backend.
const isPrimaryInstance: boolean = app.requestSingleInstanceLock()

if (!isPrimaryInstance) {
  app.exit(0)
}

// `scout desktop` shortens TMPDIR only so the lock above can bind its socket (#124688). The
// backend and every other child get the real one (the profile scratch dir) back.
if (process.env.SCOUT_DESKTOP_TMPDIR) {
  process.env.TMPDIR = process.env.SCOUT_DESKTOP_TMPDIR
  delete process.env.SCOUT_DESKTOP_TMPDIR
}

const SCOUT_HOME: string = resolveDesktopScoutHome({
  home: app.getPath('home'),
  directoryExists,
  readWindowsHome: (): string | null => readWindowsUserEnvVar('SCOUT_HOME')
})

// #77311: `desktop.electron_flags` and the renderer heap ceiling
// (`desktop.renderer_max_old_space_mb`) used to reach Chromium only through
// the `scout desktop` launcher's argv, so a packaged app opened from its
// Start-menu / .desktop entry ran with no `--js-flags` at all. Apply them here
// from config.yaml, before `ready` — Chromium copies `js-flags` to renderer
// processes only from the browser's pre-launch command line.
{
  let desktopLaunchYaml: string = ''

  try {
    desktopLaunchYaml = fs.readFileSync(path.join(SCOUT_HOME, 'config.yaml'), 'utf8')
  } catch {
    void 0 // first run: no config yet → Chromium defaults
  }

  const desktopLaunchConfig = readDesktopLaunchConfig(desktopLaunchYaml)

  // `desktop.renderer_accessibility: false` must reach packaged launches too,
  // not only the `scout desktop` launcher's env bridge (#118271).
  if (
    desktopLaunchConfig.rendererAccessibility === false &&
    process.env.SCOUT_DESKTOP_RENDERER_ACCESSIBILITY === undefined
  ) {
    process.env.SCOUT_DESKTOP_RENDERER_ACCESSIBILITY = '0'
  }

  for (const planned of planLaunchSwitches(desktopLaunchConfig, process.argv.slice(1))) {
    if (planned.value === undefined) {
      app.commandLine.appendSwitch(planned.name)
    } else {
      app.commandLine.appendSwitch(planned.name, planned.value)
    }

    console.log(
      `[scout] desktop launch switch from config.yaml: --${planned.name}${planned.value === undefined ? '' : `=${planned.value}`}`
    )
  }
}

// ACTIVE_SCOUT_ROOT — the canonical mutable Scout install. Same path
// install.ps1 / install.sh use, so a desktop-only user and a CLI-only user end
// up with identical layouts and can share one install.
const ACTIVE_SCOUT_ROOT = path.join(SCOUT_HOME, 'scout-agent')
setNoConsoleGitRoots([!IS_PACKAGED ? SOURCE_REPO_ROOT : null, ACTIVE_SCOUT_ROOT])
// VENV_ROOT — venv lives inside the repo, exactly like install.ps1 does it.
const VENV_ROOT = path.join(ACTIVE_SCOUT_ROOT, 'venv')
// BOOTSTRAP_COMPLETE_MARKER — written by the first-launch bootstrap runner
// (Phase 1D) after install.ps1 has completed all stages and the user has
// finished initial configuration. Presence of this marker means the install
// is in a known-good state and we can skip the bootstrap flow on subsequent
// boots, going straight to `resolveScoutBackend()`. Missing or stale marker
// means we re-run the bootstrap; install.ps1's stages are idempotent so a
// re-run on an already-good install just discovers everything in place.
//
// We deliberately put the marker INSIDE ACTIVE_SCOUT_ROOT (not alongside)
// so that deleting the checkout to start fresh also deletes the marker --
// avoids the confusing "marker exists but checkout is gone" state.
const BOOTSTRAP_COMPLETE_MARKER = path.join(ACTIVE_SCOUT_ROOT, '.scout-bootstrap-complete')
const BOOTSTRAP_MARKER_SCHEMA_VERSION = 1
const DESKTOP_UPDATE_CONFIG_PATH = path.join(app.getPath('userData'), 'updates.json')
const DESKTOP_WINDOW_STATE_PATH = path.join(app.getPath('userData'), 'window-state.json')
// active-profile.json records which Scout profile the desktop launches its
// local backend as. When set, startScout() passes `scout --profile <name>
// dashboard …`, which deterministically pins SCOUT_HOME (see
// _apply_profile_override in scout_backend/main.py) and bypasses the sticky
// ~/.scout/active_profile file. Unset (null) preserves the legacy behavior:
// no --profile flag, so the backend honors active_profile / default.

// Mirrors scout_backend.profiles._PROFILE_ID_RE so we never hand the backend a
// value its profile resolver would reject and exit on.
const PROFILE_NAME_RE = DESKTOP_PROFILE_NAME_RE
// Branch we track for self-update. The GUI work has merged to main, so this
// tracks main. User can also override at runtime via
// scoutDesktop.updates.setBranch().
const DEFAULT_UPDATE_BRANCH = 'main'
// desktop.log lives under SCOUT_HOME/logs/ so it sits next to agent.log,
// errors.log, gateway.log produced by scout_logging.setup_logging — one log
// directory per user, regardless of which UI surface produced the line.
const DESKTOP_LOG_PATH = path.join(SCOUT_HOME, 'logs', 'desktop.log')
const DESKTOP_LOG_FLUSH_MS = 120
const DESKTOP_LOG_BUFFER_MAX_CHARS = 64 * 1024
// Bound desktop.log on disk. It is an append-only forensic log, so a boot loop
// (version-skew crash -> backend exits instantly -> renderer keeps hitting
// Retry) appends the full bootstrap transcript every attempt and grows without
// bound — we have seen it reach ~326 GB and exhaust the disk, which then breaks
// update/install (no room for git/venv/npm temp files). The cap, the cascade
// and the discard ceiling live in log-rotation.ts, shared with the Chromium
// log below.

// #100573: keep the FATAL line and a local minidump for the next Linux SIGTRAP.
// Both must be wired before `app` is ready; the log-file switch is inherited by
// every child process, so a zygote or GPU CHECK lands in the same file.
// Chromium opens an explicit --log-file with APPEND_TO_OLD_LOG_FILE, so this
// one accumulates across launches exactly like desktop.log: bound it the same
// way, and never let optional diagnostics fail the shell's startup.
const CRASH_DIAGNOSTICS_LOGS_DIR = path.dirname(DESKTOP_LOG_PATH)

const CRASH_DIAGNOSTICS = linuxCrashDiagnostics(CRASH_DIAGNOSTICS_LOGS_DIR)
const CHROMIUM_LOG_PATH = path.join(CRASH_DIAGNOSTICS_LOGS_DIR, CHROMIUM_LOG_FILENAME)

enableLinuxCrashDiagnostics(CRASH_DIAGNOSTICS, CRASH_DIAGNOSTICS_LOGS_DIR, {
  ensureLogsDir: dir => fs.mkdirSync(dir, { recursive: true }),
  reclaimChromiumLog: file => rotateLogIfNeededSync(file),
  appendSwitch: (name, value) => app.commandLine.appendSwitch(name, value),
  startCrashReporter: options => crashReporter.start(options)
})

const BOOT_FAKE_MODE = process.env.SCOUT_DESKTOP_BOOT_FAKE === '1'
const BOOT_FAKE_ERROR = process.env.SCOUT_DESKTOP_BOOT_FAKE_ERROR || ''
// Automated teardown (Playwright's app.close(), harness scripts) quits with
// nobody to answer a modal, so the active-work confirmation would hang the
// caller instead of letting the process exit. Force quits set this.
const SKIP_QUIT_CONFIRM = process.env.SCOUT_DESKTOP_SKIP_QUIT_CONFIRM === '1'
// One launch decision must reach both the renderer and every backend spawn.
const GUEST_ONBOARDING: boolean = guestOnboardingEnabled()

const BOOT_FAKE_STEP_MS = (() => {
  const raw = Number.parseInt(String(process.env.SCOUT_DESKTOP_BOOT_FAKE_STEP_MS || ''), 10)

  if (!Number.isFinite(raw) || raw <= 0) {
    return 650
  }

  return Math.max(120, raw)
})()

const APP_NAME: string = IDENTITY_APP_NAME || process.env.SCOUT_DESKTOP_APP_NAME || 'Scout'
const HUD_WINDOW_TITLE = `${APP_NAME} HUD`
const TITLEBAR_HEIGHT = 34
const MACOS_TRAFFIC_LIGHTS_HEIGHT = 14

const WINDOW_BUTTON_POSITION = {
  x: 24,
  y: TITLEBAR_HEIGHT / 2 - MACOS_TRAFFIC_LIGHTS_HEIGHT / 2
}

// Right-edge window-control reservation lives in titlebar-overlay-width.ts
// (pure + unit-testable); computeNativeOverlayWidth() applies it per platform.
// It's only the pre-layout fallback — the renderer measures the exact overlay
// width live via the Window Controls Overlay API.
// The apple-touch PNG bakes in the macOS-style ~10% margin, which is correct
// for the dock but renders visibly smaller than neighboring taskbar icons on
// Windows, where icons are full-bleed. Windows prefers the full-bleed
// assets/icon.ico (shipped to resources/ via extraResources) and only falls
// back to the padded PNG if the ico is missing.
// The ladder is BUILT once here but each window factory RE-RESOLVES through
// resolveAppIcon (decoding probe): existence alone is not proof the bytes
// decode, and an undecodable icon must never take the main process down.
const APP_ICON_PATHS = appIconCandidates({
  isWindows: IS_WINDOWS,
  appRoot: APP_ROOT,
  resourcesPath: process.resourcesPath,
  unpackedPathFor
})

let rendererTitleBarTheme = null

// Force the NATIVE window appearance (vibrancy material, titlebar, the
// pre-first-paint window background) to follow the APP theme instead of the
// OS appearance. With `vibrancy` set, macOS paints an NSVisualEffectView that
// tracks the window's effective appearance and ignores `backgroundColor` —
// so a dark-themed app on a light-mode Mac flashes a white material on every
// new window until the renderer covers it. The renderer reports its mode via
// 'scout:native-theme' ('dark' | 'light' | 'system'); we pin
// nativeTheme.themeSource to it and persist the value so cold launches paint
// correctly before the renderer has even loaded.
const NATIVE_THEME_CONFIG_PATH = path.join(app.getPath('userData'), 'native-theme.json')
const THEME_SOURCES = new Set(['dark', 'light', 'system'])

function readPersistedThemeSource() {
  try {
    const parsed = JSON.parse(fs.readFileSync(NATIVE_THEME_CONFIG_PATH, 'utf8'))

    if (parsed && THEME_SOURCES.has(parsed.themeSource)) {
      return parsed.themeSource
    }
  } catch {
    // Missing / malformed → follow the OS like a fresh install.
  }

  return 'system'
}

function writePersistedThemeSource(mode) {
  try {
    fs.mkdirSync(path.dirname(NATIVE_THEME_CONFIG_PATH), { recursive: true })
    fs.writeFileSync(NATIVE_THEME_CONFIG_PATH, JSON.stringify({ themeSource: mode }, null, 2), 'utf8')
  } catch (error) {
    rememberLog(`[theme] write native theme failed: ${error.message}`)
  }
}

nativeTheme.themeSource = readPersistedThemeSource()

// Window translucency (see-through window). One lever, 0–100; 0 = off (the
// default). Two modes share the lever (see electron/translucency.ts and
// store/translucency): 'clear' maps it to the native window opacity so the
// desktop shows through the whole window; 'glass' keeps the window opaque
// and lets the renderer thin its surfaces over a platform material instead
// — a matte blur with full-contrast text. macOS uses vibrancy; Windows 11
// uses DWM acrylic/mica/tabbed. Persisted so a cold launch applies it at
// window creation, before the renderer reports its value.
// macOS + Windows only; `setOpacity` is a no-op on Linux.
const TRANSLUCENCY_CONFIG_PATH = path.join(app.getPath('userData'), 'translucency.json')

function readPersistedTranslucency() {
  try {
    return normalizeTranslucency(JSON.parse(fs.readFileSync(TRANSLUCENCY_CONFIG_PATH, 'utf8')), GLASS_SUPPORTED)
  } catch {
    // Nothing persisted yet — a first launch. Glass ships on, so the FIRST
    // window has to be created with the glass backing already: a window born
    // opaque cannot reliably be swapped to glass afterwards (see
    // windowBackingOptions). nativeTheme is the only appearance signal main
    // has this early; the renderer's first resolved send corrects it.
    return defaultTranslucencyState(nativeTheme.shouldUseDarkColors ? 'dark' : 'light', GLASS_SUPPORTED, IS_WINDOWS)
  }
}

function writePersistedTranslucency(state) {
  try {
    fs.mkdirSync(path.dirname(TRANSLUCENCY_CONFIG_PATH), { recursive: true })
    fs.writeFileSync(TRANSLUCENCY_CONFIG_PATH, JSON.stringify(state, null, 2), 'utf8')
  } catch (error) {
    rememberLog(`[translucency] write failed: ${error.message}`)
  }
}

let translucencyState = readPersistedTranslucency()

// Chat windows whose webContents backing follows translucency (primary,
// instance peers, session windows). The HUD / pet overlay / quick entry /
// wake indicator are `transparent: true` windows that own their backgrounds —
// painting a themed backing onto them would turn them into opaque rectangles.
const translucencyBackedWindows = new WeakSet()

// Set a live window's native opacity, but only when the state asks it to fade
// — or when the window is already faded and is on its way back to opaque. The
// window's own opacity is the record of whether that door was ever opened; see
// opacityNeedsSetting for why it matters that it stays shut.
function applyWindowOpacity(win) {
  const opacity = windowOpacityFor(translucencyState)

  if (typeof win.setOpacity === 'function' && opacityNeedsSetting(opacity, win.getOpacity?.() ?? 1)) {
    win.setOpacity(opacity)
  }
}

// Re-apply translucency to a live window (runtime toggle, no recreation).
// Opacity goes through applyWindowOpacity, which knows when the call is worth
// making at all. The backing swap is the glass half: Chromium composites the
// page against the window backing BEFORE the OS composites the window, so
// glass needs the backing dropped for the platform material to reach it, and
// every other state needs the opaque themed backing (anti-flash, and it is
// what makes clear mode fade to the desktop instead of to black).
//
// `changed` says which native properties actually need touching. Dragging the
// intensity slider emits ~100 updates, and in glass mode NONE of them change
// anything native — the tint is painted by the renderer and windowOpacityFor
// answers off `fade`, not `intensity`, there. Re-issuing setVibrancy on every
// tick restarts its 150ms animation before macOS can settle the material,
// which reads as jank and flattens the frost levels into each other. Windows
// setBackgroundMaterial is instantaneous but still skipped on tint-only ticks.
// The glass Fade lever is the one glass drag that does reach main, and it
// costs exactly what a Clear drag costs: one setOpacity.
//
// CAUTION (measured, macOS 26 / Electron 40): a runtime
// setBackgroundColor('#00000000') is silently LOST on a window whose
// compositor hasn't been up for a few seconds — including calls from
// 'ready-to-show' and 'did-finish-load'. Cold launches therefore must not
// rely on this path: windows are BORN with the right backing
// (windowBackingOptions at each creation site). This path only has to cover
// live toggles from Settings, where the window is long settled.
function applyWindowTranslucency(win, changed = { backing: true, material: true, opacity: true }) {
  if (!win || win.isDestroyed()) {
    return
  }

  try {
    // Backing swap + material are scoped to registered chat windows (see
    // translucencyBackedWindows above).
    if (translucencyBackedWindows.has(win)) {
      if (changed.backing && typeof win.setBackgroundColor === 'function') {
        win.setBackgroundColor(glassActive(translucencyState) ? '#00000000' : getWindowBackgroundColor())
      }

      if (changed.material) {
        // Glass frost level = the platform material. Animate the macOS hop so
        // a deliberate frost switch feels continuous — which only works if we
        // don't re-issue it on unrelated updates. Windows has no equivalent
        // animation option; setBackgroundMaterial is instantaneous.
        if (IS_MAC && typeof win.setVibrancy === 'function') {
          win.setVibrancy(vibrancyForTranslucency(translucencyState), { animationDuration: 150 })
        }

        if (IS_WINDOWS && GLASS_SUPPORTED && typeof win.setBackgroundMaterial === 'function') {
          win.setBackgroundMaterial(backgroundMaterialFor(translucencyState))
        }
      }
    }

    if (changed.opacity) {
      applyWindowOpacity(win)
    }
  } catch (error) {
    rememberLog(`[translucency] apply failed: ${error.message}`)
  }
}

// Constructor options every chat window shares for its translucency surface:
// the platform material, the webContents backing, and a native opacity only if
// the state actually fades — all under the CURRENT state. Glass omits
// backgroundColor so the material shows from the first frame (Electron hands a
// translucent window a transparent default backing, and runtime swaps are lost
// early in a window's life — see applyWindowTranslucency); otherwise the opaque
// themed anti-flash backing.
//
// Call sites also register the window in translucencyBackedWindows so a live
// toggle can re-apply. The HUD, pet overlay, quick entry and wake indicator
// are `transparent: true` windows that own their backgrounds and are
// deliberately not chat windows.
function chatWindowSurfaceOptions() {
  return {
    vibrancy: IS_MAC ? vibrancyForTranslucency(translucencyState) : undefined,
    // Pin the material to its ACTIVE appearance: several NSVisualEffectView
    // materials collapse to a shared inactive look when the window blurs
    // (measured on macOS 26: sidebar, popover and under-window composited
    // pixel-identically once unfocused), which would quietly erase the
    // user's frost choice whenever they click elsewhere. Only observable
    // under glass — everywhere else the page buries the material.
    visualEffectState: IS_MAC ? ('active' as const) : undefined,
    // NOT `transparent: true` on Windows. The backdrop material already makes
    // the window translucent on its own: `IsTranslucent` answers yes off
    // `background_material_` alone, which is what gives the page its transparent
    // default backing, and `SetBackgroundMaterial` flips widget translucency
    // live, so a Clear→Glass toggle needs no recreate either way. Its one gate
    // is a frameless window, and `titleBarStyle: 'hidden'` already makes
    // `has_frame()` false here.
    //
    // What `transparent` adds on top is permanent and unwanted: it pins the
    // widget to kTranslucent for the window's whole life, so even glass-OFF
    // windows pay a DirectComposition redraw per frame (electron#39895), and it
    // opts into the documented transparent-window limits — including that a
    // RESIZABLE transparent window is unsupported and breaks (electron#48421).
    // Every chat window is resizable.
    backgroundMaterial: IS_WINDOWS && GLASS_SUPPORTED ? backgroundMaterialFor(translucencyState) : undefined,
    ...windowOpacityOptions(translucencyState),
    ...windowBackingOptions(translucencyState, getWindowBackgroundColor())
  }
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

// Background color to paint a window with BEFORE its renderer loads, so a new
// (or reopened) window doesn't flash white/light in dark mode. Prefer the theme
// the renderer last reported; fall back to the OS preference on first launch.
function getWindowBackgroundColor() {
  if (rendererTitleBarTheme && isHexColor(rendererTitleBarTheme.background)) {
    return rendererTitleBarTheme.background
  }

  return nativeTheme.shouldUseDarkColors ? '#111111' : '#f7f7f7'
}

// Transparent WCO — renderer chrome shows through. rgba(0,0,0,0) can fall back
// to GetFrameColor() on some Electron builds; rgba(1,0,0,0) is the escape hatch.
const TITLEBAR_OVERLAY_COLOR = 'rgba(1, 0, 0, 0)'

// WSLg returns false: the RDP host paints nothing for a frameless window and
// Electron's own overlay drifts its hit-region under RAIL, so the renderer
// paints its own min/max/close (wslg-window-controls.tsx) over the
// scout:window-control IPC channel. See titleBarOverlayOptions.
function getTitleBarOverlayOptions() {
  return titleBarOverlayOptions({
    platform: IS_MAC ? 'mac' : IS_WINDOWS ? 'windows' : IS_WSL ? 'wslg' : 'linux',
    darwinMajor: DARWIN_MAJOR,
    titlebarHeight: TITLEBAR_HEIGHT,
    color: TITLEBAR_OVERLAY_COLOR,
    foreground:
      rendererTitleBarTheme && isHexColor(rendererTitleBarTheme.foreground) ? rendererTitleBarTheme.foreground : null,
    dark: nativeTheme.shouldUseDarkColors
  })
}

// Push refreshed overlay options to a live window after a theme/appearance
// change. No-op only on plain (non-WSL) Linux, where getTitleBarOverlayOptions()
// returns false; the try/catch additionally guards builds where
// setTitleBarOverlay isn't supported.
function applyTitleBarOverlay(win) {
  const options = getTitleBarOverlayOptions()

  if (!options || typeof options !== 'object') {
    return
  }

  try {
    win?.setTitleBarOverlay?.(options)
  } catch {
    // Overlay not supported on this platform/build — leave the frameless
    // titlebar as-is.
  }
}

const MEDIA_MIME_TYPES = {
  '.avi': 'video/x-msvideo',
  '.bmp': 'image/bmp',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp'
}

const PREVIEW_HTML_EXTENSIONS = new Set(['.html', '.htm'])
const PREVIEW_PDF_EXTENSIONS = new Set(['.pdf'])
const PREVIEW_WATCH_DEBOUNCE_MS = 120
const LOCAL_PREVIEW_HOSTS = new Set(['0.0.0.0', '127.0.0.1', '::1', '[::1]', 'localhost'])
const TEXT_PREVIEW_MAX_BYTES = 512 * 1024

const PREVIEW_LANGUAGE_BY_EXT = {
  '.c': 'c',
  '.conf': 'ini',
  '.cpp': 'cpp',
  '.css': 'css',
  '.csv': 'csv',
  '.go': 'go',
  '.graphql': 'graphql',
  '.h': 'c',
  '.hpp': 'cpp',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'jsx',
  '.kt': 'kotlin',
  '.lua': 'lua',
  '.md': 'markdown',
  '.mjs': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sh': 'shell',
  '.sql': 'sql',
  '.svg': 'xml',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.txt': 'text',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'shell'
}

function looksBinary(buffer) {
  if (!buffer.length) {
    return false
  }

  let suspicious = 0

  for (const byte of buffer) {
    if (byte === 0) {
      return true
    }

    // Allow common whitespace controls: tab, LF, CR.
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      suspicious += 1
    }
  }

  return suspicious / buffer.length > 0.12
}

function previewFileMetadata(filePath, mimeType) {
  let byteSize = 0
  let binary = false

  try {
    const stat = fs.statSync(filePath)
    byteSize = stat.size

    if (!mimeType.startsWith('image/')) {
      const fd = fs.openSync(filePath, 'r')

      try {
        const sample = Buffer.alloc(Math.min(byteSize, 4096))
        const bytesRead = fs.readSync(fd, sample, 0, sample.length, 0)
        binary = looksBinary(sample.subarray(0, bytesRead))
      } finally {
        fs.closeSync(fd)
      }
    }
  } catch {
    // Metadata is best-effort; the read handlers surface hard errors later.
  }

  return {
    binary,
    byteSize,
    large: byteSize > TEXT_PREVIEW_MAX_BYTES
  }
}

app.setName(APP_NAME)

// No application menu until the first window exists. Electron would otherwise
// install its default menu at `will-finish-launching` (before `ready`), and a
// key equivalent routed through that menu's delegate with no window open
// segfaults the macOS shell — the updater relaunch races the user's keystroke
// (#115332). Must run at module scope: on macOS a later `null` never removes
// an installed menu. The real menu lands in installApplicationMenuAfterFirstWindow.
Menu.setApplicationMenu(null)

// Windows toast notifications silently no-op unless an AppUserModelID is set:
// `new Notification().show()` returns without error and nothing appears. The
// AUMID must match the installed Start Menu shortcut's AUMID, which
// electron-builder derives from the build `appId` (com.spaceshipresearch.scout) —
// keep this string in sync with package.json `build.appId`. macOS/Linux don't
// need this, so gate it on Windows. (Fixes: desktop approval/turn notifications
// never firing on Windows.)
if (IS_WINDOWS) {
  app.setAppUserModelId(IDENTITY_APP_NAME ? PRODUCT_IDENTITY.appId : 'com.spaceshipresearch.scout')
}

// Seed the native About panel with the best-known Scout version. This is
// refreshed on every open via showAboutPanelFresh, so an in-place
// `scout update` mid-session is reflected without an app restart; the seed
// covers the first open and any non-menu invocation path. Never seed empty:
// an empty applicationVersion falls back to the bundle version, which is the
// 0.0.0 placeholder on local builds (#124581).
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  applicationVersion: nativeAboutVersion(appVersionInfo(INSTALL_STAMP, '', app.getVersion())),
  copyright: 'Copyright © 2026 SpaceshipResearch'
})

// Custom scheme for streaming audio/video into the renderer. Local paths read
// from this machine; remote paths are proxied through the configured gateway
// with main-process authentication. This avoids whole-file data URLs and keeps
// playback seekable and Range-aware. Must be registered before app readiness.
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_PROTOCOL,
    privileges: {
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true
    }
  }
])

function registerMediaProtocol(): void {
  const handler: ReturnType<typeof createMediaProtocolHandler> = createMediaProtocolHandler({
    ensureRemoteBearer: (baseUrl: string): Promise<string | null> => ensureNativeAccessToken(baseUrl),
    // Electron's file:// loader ignores Range, which prevents video seeking.
    fetchLocal: fetchLocalMedia,
    fetchRemote: (url, headers, method) =>
      electronNet.fetch(url, {
        bypassCustomProtocolHandlers: true,
        credentials: 'omit',
        headers,
        method
      }),
    fetchRemoteWithCookies: (url, headers, method) => {
      const oauthSession = getOauthSessionForUrl(url)

      if (!oauthSession) {
        throw new Error('OAuth session partition is unavailable.')
      }

      return oauthSession.fetch(url, {
        bypassCustomProtocolHandlers: true,
        credentials: 'include',
        headers,
        method
      })
    },
    resolveLocalFile: async filePath => {
      // On a Windows host with a WSL backend the media path arrives as a
      // WSL/POSIX path (`/home/...`, `/mnt/c/...`) the Windows fs can't open
      // as-is; bridge it to a UNC/drive form first, same as directory reads.
      // The protocol handler already percent-decoded the pathname, so this
      // boundary bridges only — re-decoding/stripping would corrupt the path.
      const { resolvedPath } = await resolveReadableFileForIpc(resolveMediaStreamFile(filePath), {
        purpose: 'Media stream'
      })

      return resolvedPath
    },
    // Claim-guarded (#90812): a media stream load can race a renderer's own
    // reconnect dial for the same (connectionId, profile) scope; coalescing
    // here avoids bootstrapping a second SSH tunnel / remote dashboard.
    resolveRemoteConnection: ({ connectionId, profile }) =>
      backendDialClaims.run(backendScopeKey(connectionId, profile), () =>
        connectionId ? ensureRegistryBackend(connectionId, profile) : ensureBackend(profile)
      )
  })

  protocol.handle(MEDIA_PROTOCOL, handler)
}

let mainWindow = null
const backendConnectionState = createBackendConnectionState<ReturnType<typeof spawn>, any>()


const remoteLiveness = new RemoteLivenessTracker()
const remoteRevalidation = new RemoteRevalidationCoordinator()
// Single-owner reconnect/dial claim (#90812): reconnectGateway()'s in-flight
// lock is per-renderer, so two windows racing one wake can both invoke the
// backend ensure IPC and double-dial a pooled SSH backend. Main owns backend
// lifecycles, so concurrent dials for one (connectionId, profile) scope
// coalesce here — the second caller awaits the first spawn's result.
const backendDialClaims = new BackendDialClaims() // profile -> { process, port, token, connectionPromise, lastActiveAt }
const profileDeletionGate = new ProfileDeletionGate()

// rememberLog() state. Declared here, before the top-level
// readPersistedPoolLimits() call below, because that call logs during module
// evaluation; declaring these later crashed launch with `undefined.push` in
// the packaged build (esbuild lowers the TDZ to undefined instead of throwing).
const scoutLog: string[] = []
let desktopLogBuffer = ''
let desktopLogFlushTimer = null
let desktopLogFlushPromise = Promise.resolve()

function spawnPriorityFrom(value: unknown): LocalBackendSpawnPriority {
  return value === 'foreground' ? 'foreground' : 'background'
}

// Auto-reload budget for renderer crashes, shared by EVERY window (primary,
// secondary session, instance) so a crash loop anywhere is suppressed after
// the same budget instead of reloading per-window forever. A deterministic
// startup crash would otherwise loop forever (reload → crash → reload),
// pinning CPU and spamming logs. Allow a few reloads per rolling window, then
// stop and leave the dead window so the user can read the error / quit.
const RENDERER_RELOAD_WINDOW_MS = 60_000
const RENDERER_RELOAD_MAX = 3
const rendererReloadTimesRef: { current: number[] } = { current: [] }
// Latched bootstrap failure: when the first-launch install fails, we hold
// onto the error so subsequent startScout() calls (e.g. the renderer's
// ensureGatewayOpen retrying after the WS won't open) return the same error
// instead of re-running install.ps1 in a hot loop. Cleared explicitly by
// the renderer's "Reload and retry" path or by quitting the app.
let bootstrapFailure = null
// Latched non-bootstrap backend spawn failure — stops getConnection() from
// respawning scout serve backend children in a tight loop while boot is broken.
let backendStartFailure = null
// Latched CONFIRMED remote reauth failure. Remote failures deliberately do not
// latch via backendStartFailure (they're usually transient and must stay
// retryable), but a rejected session cannot self-heal — and the non-latching
// path actively breaks recovery: each retry re-emits running:true and hides
// the boot-failure overlay, so the "Sign in" button flickers away before it
// can be clicked. Cleared on every recovery path and on a confirmed sign-in.
let remoteReauthFailure = null
// Active first-launch install, so the renderer's Cancel button (and app quit)
// can abort the in-flight install.sh/ps1 instead of leaving it running.
let bootstrapAbortController = null
// Explicit "the user asked for a repair" flag. Repair used to signal intent by
// deleting the bootstrap marker, which stranded healthy installs whose only
// problem was a transient backend error (#72166). Intent now lives here, so
// repair can force the installer without destroying provenance about how the
// install was created. Cleared once the reinstall is under way.
let bootstrapRepairRequested = false
const remoteHeaderSessions = new WeakSet<object>()
const remoteWsHeaderStore = createRemoteWsHeaderStore()
const previewWatchers = new Map()
let previewShortcutActive = false
const f12ShortcutActiveWindows = new Set<number>()
let nativeThemeListenerInstalled = false

let bootProgressState = {
  error: null,
  fakeMode: BOOT_FAKE_MODE,
  message: 'Waiting to start Scout backend',
  phase: 'idle',
  progress: 0,
  retryable: false,
  running: false,
  statusCode: null,
  timestamp: Date.now()
}

// Chromium owns its --log-file for the life of the process, so the startup
// reclaim above cannot bound a shell that stays up for days writing errors.
// Poll and truncate in place; renaming would leave Chromium appending to the
// renamed inode. Unref'd so it never holds the process open.
function startChromiumLogWatcher(file) {
  const io = {
    size: f => {
      try {
        return fs.statSync(f).size
      } catch {
        return null // Not created yet — nothing has been logged.
      }
    },
    truncate: f => fs.truncateSync(f, 0)
  }

  const timer = setInterval(() => {
    try {
      if (reclaimActiveLogIfOversized(file, io)) {
        rememberLog(`[diagnostics] truncated oversized Chromium log ${file}`)
      }
    } catch {
      // Best-effort — an unbounded log beats a crashed shell.
    }
  }, ACTIVE_LOG_POLL_MS)

  timer.unref?.()
}

function rotateLogIfNeededSync(base) {
  let size

  try {
    size = fs.statSync(base).size
  } catch {
    return // No live file yet — the append (re)creates it.
  }

  for (const [op, src, dst] of planLogRotation(size, base)) {
    try {
      if (op === 'rm') {
        fs.rmSync(src, { force: true })
      } else {
        fs.renameSync(src, dst)
      }
    } catch {
      // Best-effort — logging must never block startup/shutdown.
    }
  }
}

async function rotateDesktopLogIfNeededAsync() {
  let size

  try {
    size = (await fs.promises.stat(DESKTOP_LOG_PATH)).size
  } catch {
    return // No live file yet — the append (re)creates it.
  }

  for (const [op, src, dst] of planLogRotation(size, DESKTOP_LOG_PATH)) {
    try {
      if (op === 'rm') {
        await fs.promises.rm(src, { force: true })
      } else {
        await fs.promises.rename(src, dst)
      }
    } catch {
      // Best-effort — logging must never crash the shell.
    }
  }
}

function flushDesktopLogBufferSync() {
  if (!desktopLogBuffer) {
    return
  }

  const chunk = desktopLogBuffer
  desktopLogBuffer = ''

  try {
    fs.mkdirSync(path.dirname(DESKTOP_LOG_PATH), { recursive: true })
    rotateLogIfNeededSync(DESKTOP_LOG_PATH)
    fs.appendFileSync(DESKTOP_LOG_PATH, chunk)
  } catch {
    // Logging must never block app startup/shutdown.
  }
}

function flushDesktopLogBufferAsync() {
  if (!desktopLogBuffer) {
    return desktopLogFlushPromise
  }

  const chunk = desktopLogBuffer
  desktopLogBuffer = ''

  desktopLogFlushPromise = desktopLogFlushPromise
    .then(async () => {
      await fs.promises.mkdir(path.dirname(DESKTOP_LOG_PATH), { recursive: true })
      await rotateDesktopLogIfNeededAsync()
      await fs.promises.appendFile(DESKTOP_LOG_PATH, chunk)
    })
    .catch(() => {
      // Logging must never crash the desktop shell.
    })

  return desktopLogFlushPromise
}

function scheduleDesktopLogFlush() {
  if (desktopLogFlushTimer) {
    return
  }

  desktopLogFlushTimer = setTimeout(() => {
    desktopLogFlushTimer = null
    void flushDesktopLogBufferAsync()
  }, DESKTOP_LOG_FLUSH_MS)
}

function rememberLog(chunk) {
  const text = String(chunk || '').trim()

  if (!text) {
    return
  }

  // One timestamp per chunk: lines arriving in the same event happened
  // at the same moment.  Local time, same shape as agent.log/gui.log.
  const stamp = formatLogStamp(new Date())
  const lines = text.split(/\r?\n/).map(line => formatDesktopLogLine(line, stamp))
  scoutLog.push(...lines)

  if (scoutLog.length > 300) {
    scoutLog.splice(0, scoutLog.length - 300)
  }

  desktopLogBuffer += `${lines.join('\n')}\n`

  if (desktopLogBuffer.length >= DESKTOP_LOG_BUFFER_MAX_CHARS) {
    if (desktopLogFlushTimer) {
      clearTimeout(desktopLogFlushTimer)
      desktopLogFlushTimer = null
    }

    void flushDesktopLogBufferAsync()

    return
  }

  scheduleDesktopLogFlush()
}

// Main-process stalls leave renderer-scoped lifecycle logging unable to run.
// When the loop resumes, retain the delayed timer's timing in desktop.log so a
// Windows AppHang report can be correlated without changing tray semantics.
const mainProcessLagWatchdog = createMainProcessLagWatchdog({
  cadenceMs: 1_000,
  thresholdMs: 2_000,
  now: Date.now,
  log: rememberLog,
  setInterval,
  clearInterval
})

installCrashForensics({ flush: flushDesktopLogBufferSync, log: rememberLog })

// A rejected loadURL leaves a blank window and, unhandled, no trace anywhere
// the user can send us. `label` names the surface so the log says which one.
function loadWindowUrl(win, url, label) {
  win.loadURL(url).catch(error => rememberLog(`${label} failed to load: ${describeCrashReason(error)}`))
}

const EXTERNAL_OPEN_DEPS: ExternalOpenDeps = {
  isWsl: IS_WSL,
  spawn: (cmd, args, opts) => spawn(cmd, args, opts),
  openExternal: url => shell.openExternal(url),
  openFile: openExternalFile,
  notifyFailure: broadcastOpenFailed,
  log: rememberLog
}

// Deps for the pre-open stat guard (see openExternalFile): a miss is
// broadcast with the 'missing-file' code so the dialog shows file-not-found
// copy; other stat failures only log.
const GUARD_REPORT_DEPS = {
  log: rememberLog,
  reportMissing: (rawUrl: string, message: string) => broadcastOpenFailed(rawUrl, message, 'missing-file')
}

// The single route every external URL open funnels through (external-open.ts).
// main.ts only binds the electron deps; all open/fallback logic lives in the
// module so it unit-tests without loading electron.
function openExternalUrl(rawUrl: string) {
  return externalOpen(String(rawUrl || '').trim(), EXTERNAL_OPEN_DEPS)
}

async function openPreviewInBrowser(rawUrl: string) {
  const result = await externalOpen(String(rawUrl || '').trim(), EXTERNAL_OPEN_DEPS)

  // Only an invalid/unsupported URL is a hard "no" for the caller; an open
  // failure already raised the fallback modal with the URL.
  return !(result.ok === false && result.reason === 'invalid')
}

// `file://` URLs come from the artifacts panel (the renderer can't open them
// itself because Chromium blocks that navigation). Reveal the file in the
// system file manager instead of dispatching to the OS file association:
// on Windows, archive artifacts (.gz/.tar) have no usable association, and
// handing the path back to the OS shell bounces the open through the default
// (Chromium) handler, which re-downloads the file — an infinite download loop
// (issue #53170). Reveal-in-folder never re-opens the file, so it can't loop.
//
// A short per-path dedupe window additionally absorbs renderer-side double
// clicks and retry storms so repeated open requests can't pile up windows.
const FILE_REVEAL_DEDUPE_MS = 1_500
const recentFileReveals = new Map<string, number>()

export function _resetFileRevealDedupeForTest() {
  recentFileReveals.clear()
}

async function openExternalFile(rawUrl: string) {
  let localPath: string

  try {
    localPath = resolveRequestedPathForIpc(rawUrl, { purpose: 'Open external file' })
  } catch {
    return
  }

  // A missing file must never reach the reveal fallback: on macOS revealing a
  // non-existent path is silently a no-op, so the click would do nothing at
  // all. Say "missing" before the OS is asked. Only ENOENT/ENOTDIR count as
  // missing — any other stat failure (EACCES on a locked volume, ELOOP) is
  // logged and still reaches the OS below, so an existing-but-locked file
  // keeps its real error instead of a fabricated miss. Classification lives
  // in external-open.ts so it unit-tests without electron. Misses are
  // reported here and not rethrown: external-open.ts documents that openFile
  // handles its own reporting, and rethrowing would stack a second dialog.
  try {
    assertExistingPathForOpen(localPath, 'Open external file')
  } catch (error) {
    if (reportPreOpenStatFailure(error, rawUrl, GUARD_REPORT_DEPS)) {
      return
    }
  }

  const now = Date.now()
  const lastReveal = recentFileReveals.get(localPath)

  if (lastReveal !== undefined && now - lastReveal < FILE_REVEAL_DEDUPE_MS) {
    rememberLog(`[file] duplicate reveal request within ${FILE_REVEAL_DEDUPE_MS}ms; ignored: ${localPath}`)

    return
  }

  recentFileReveals.set(localPath, now)

  // Prune stale entries so the map can't grow without bound over a long session.
  for (const [path, ts] of recentFileReveals) {
    if (now - ts >= FILE_REVEAL_DEDUPE_MS && path !== localPath) {
      recentFileReveals.delete(path)
    }
  }

  try {
    shell.showItemInFolder(localPath)
  } catch (error) {
    rememberLog(`[file] reveal in folder failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// An open failure is surfaced to the renderer as a modal carrying the URL, so
// a dead system-browser click (e.g. no https handler registered on Linux) is
// never silent. `code` tags the failure class (e.g. 'missing-file') so the
// dialog can show accurate localized copy instead of the generic one.
// Broadcast to every window — the trigger has no single sender.
function broadcastOpenFailed(url: string, message: string, code?: 'missing-file') {
  rememberLog(`[open-failed] ${url}: ${message}`)

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('scout:external-open-failed', { url, message, ...(code ? { code } : {}) })
  }
}

function ensureWslWindowsFonts() {
  if (!IS_WSL) {
    return
  }

  const fontsDir = ['/mnt/c/Windows/Fonts', '/mnt/c/windows/fonts'].find(candidate => {
    try {
      return fs.statSync(candidate).isDirectory()
    } catch {
      return false
    }
  })

  if (!fontsDir) {
    return
  }

  try {
    const confDir = path.join(app.getPath('home'), '.config', 'fontconfig', 'conf.d')
    const confPath = path.join(confDir, '99-scout-wsl-windows-fonts.conf')
    let existing = ''

    try {
      existing = fs.readFileSync(confPath, 'utf8')
    } catch {
      existing = ''
    }

    if (existing.includes(fontsDir)) {
      return
    }

    fs.mkdirSync(confDir, { recursive: true })
    fs.writeFileSync(
      confPath,
      `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${fontsDir}</dir>\n</fontconfig>\n`
    )
    rememberLog(`[fonts] wired WSL Windows fonts for renderer: ${fontsDir}`)

    const cache = spawn('fc-cache', ['-f', fontsDir], { detached: true, stdio: 'ignore' })
    cache.on('error', () => undefined)
    cache.unref()
  } catch (error) {
    rememberLog(`[fonts] WSL font setup skipped: ${error.message}`)
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function clampBootProgress(value) {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round(numeric)))
}

function broadcastBootProgress() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const { webContents } = mainWindow

  if (!webContents || webContents.isDestroyed()) {
    return
  }

  webContents.send('scout:boot-progress', bootProgressState)
}

// The latched reauth failure whose hold has already been logged, so a burst of
// dropped updates from one in-flight sibling attempt logs once, not per event.
let bootProgressHeldFor: Error | null = null

function updateBootProgress(update, options: { allowDecrease?: boolean } = {}) {
  // A latched CONFIRMED reauth rejection owns the boot surface until a
  // recovery path clears it. Updates that are not a re-emit of that failure —
  // a running:true phase or cleared error from an attempt already in flight
  // when the latch closed, or an unrelated sibling failure that would flip
  // retryable back on — must not reach the renderer, or the overlay's Sign in
  // button flickers away again (#95701).
  if (shouldHoldBootProgressForReauth(remoteReauthFailure ? remoteReauthFailure.message : null, update)) {
    if (bootProgressHeldFor !== remoteReauthFailure) {
      bootProgressHeldFor = remoteReauthFailure
      rememberLog('[boot] remote reauth latched: holding the recovery overlay against a stale boot-progress update')
    }

    return
  }

  bootProgressHeldFor = null

  const nextProgressRaw =
    typeof update.progress === 'number' ? clampBootProgress(update.progress) : bootProgressState.progress

  const nextProgress = options.allowDecrease ? nextProgressRaw : Math.max(bootProgressState.progress, nextProgressRaw)

  bootProgressState = {
    ...bootProgressState,
    ...update,
    error: update.error === undefined ? bootProgressState.error : update.error,
    fakeMode: BOOT_FAKE_MODE || Boolean(update.fakeMode),
    progress: nextProgress,
    // `retryable` rides with `error`: it survives updates that preserve the
    // error and resets alongside a new/cleared error unless explicitly set.
    retryable:
      update.retryable === undefined
        ? update.error === undefined && Boolean(bootProgressState.retryable)
        : Boolean(update.retryable),
    timestamp: Date.now()
  }

  if (update.message) {
    rememberLog(`[boot] ${update.message}`)
  }

  broadcastBootProgress()
}

async function advanceBootProgress(phase, message, progress) {
  updateBootProgress({
    phase,
    message,
    progress,
    running: true,
    error: null
  })

  if (BOOT_FAKE_MODE) {
    await sleep(BOOT_FAKE_STEP_MS)
  }
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function isGitCheckout(root: string): boolean {
  return fs.existsSync(path.join(root, '.git'))
}

function directoryExists(filePath) {
  try {
    return fs.statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

// How long the desktop lingers on the "updating, don't reopen" overlay after
// spawning the detached updater, before it quits to release the venv shim. The
// old 600ms was long enough to register the child process but far too short for
// the user to READ the overlay — the window just vanished, looked like a crash,
// and the user relaunched mid-update (the #50238 restart-loop trigger). A
// couple of seconds lets the message land and bridges the gap until the
// updater's own progress window appears. (#50419)
const UPDATE_HANDOFF_DWELL_MS = 2500

function unpackedPathFor(filePath) {
  return filePath.replace(/app\.asar(?=$|[\\/])/, 'app.asar.unpacked')
}

function findOnPath(command) {
  if (!command) {
    return null
  }

  if (path.isAbsolute(command) || command.includes(path.sep) || (IS_WINDOWS && command.includes('/'))) {
    if (!fileExists(command)) {
      return null
    }

    if (isWindowsBinaryPathInWsl(command, { isWsl: IS_WSL })) {
      return null
    }

    return command
  }

  const pathEntries = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)

  // On Windows, try PATHEXT extensions BEFORE the bare (empty-extension) name.
  // A real command must resolve via its .exe/.cmd (Windows command-resolution
  // semantics consult PATHEXT); an extensionless file — e.g. a Git-Bash
  // shell-script shim named `scout` — must not shadow `scout.cmd`/`scout.exe`.
  // The empty entry is kept LAST so callers that already include the extension
  // (py.exe, pwsh.exe, powershell.exe) still resolve.
  const extensions = buildPathExtCandidates(process.env.PATHEXT, IS_WINDOWS)

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, `${command}${extension}`)

      if (fileExists(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function isCommandScript(command) {
  return IS_WINDOWS && /\.(cmd|bat)$/i.test(command || '')
}

async function unwrapWindowsVenvScoutCommand(command, backendArgs) {
  return resolveVenvScoutCommand(command, backendArgs, {
    isWindows: IS_WINDOWS,
    isCommandScript,
    fileExists,
    directoryExists,
    canImportScoutCli,
    getVenvPython,
    buildDesktopBackendEnv,
    resolvePath: (...segments) => path.resolve(...segments),
    dirname: p => path.dirname(p),
    basename: p => path.basename(p),
    rememberLog
  })
}

function normalizeExecutablePathForCompare(commandPath) {
  if (!commandPath) {
    return null
  }

  let resolved = path.resolve(String(commandPath))

  try {
    resolved = fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved)
  } catch {
    // Fallback to path.resolve() above.
  }

  return IS_WINDOWS ? resolved.toLowerCase() : resolved
}

function looksLikeDesktopAppBinary(commandPath) {
  if (!IS_WINDOWS || !commandPath) {
    return false
  }

  const normalizedCandidate = normalizeExecutablePathForCompare(commandPath)
  const normalizedCurrentExec = normalizeExecutablePathForCompare(process.execPath)

  if (normalizedCandidate && normalizedCurrentExec && normalizedCandidate === normalizedCurrentExec) {
    return true
  }

  let resolved = path.resolve(String(commandPath))

  try {
    resolved = fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved)
  } catch {
    // Keep resolved path fallback.
  }

  const resourcesDir = path.join(path.dirname(resolved), 'resources')

  // existsSync for the archive: Electron's asar shim stats app.asar itself as a directory (so
  // fileExists was always false) and constructs the deprecated fs.Stats doing it (#96857).
  return (
    fs.existsSync(path.join(resourcesDir, 'app.asar')) || directoryExists(path.join(resourcesDir, 'app.asar.unpacked'))
  )
}

function isScoutSourceRoot(root) {
  return directoryExists(root) && fileExists(path.join(root, 'scout_backend', 'main.py'))
}

async function findPythonForRoot(root: string): Promise<string | null> {
  return resolveSourcePython(root, {
    override: process.env.SCOUT_DESKTOP_PYTHON,
    isWindows: IS_WINDOWS,
    fileExists
  })
}

async function findSystemPython() {
  if (!IS_WINDOWS) {
    // POSIX systems: PATH lookup is safe.
    for (const command of ['python3', 'python']) {
      const candidate = findOnPath(command)

      if (candidate) {
        return candidate
      }
    }

    return null
  }

  // Windows: PATH-based detection has TWO landmines we have to dodge.
  //
  //  (1) The Microsoft Store "Python stub" lives at
  //      %LOCALAPPDATA%\Microsoft\WindowsApps\python.exe and is on PATH
  //      by default on modern Windows. It's a redirector that opens the
  //      Store window if no Store Python is installed. Running it for
  //      `-m venv` would either succeed (real Store install — fine) or
  //      pop the Store dialog (bad UX during boot).
  //  (2) `py.exe` (Python launcher) is missing from per-user installs
  //      that didn't check the launcher option, so PATH-only checks
  //      miss real Python 3.13 installs (user-reported case).
  //
  // We also restrict ourselves to Python 3.11–3.13. 3.14 is the latest
  // CPython but several Scout deps (notably pywinpty's Rust-built
  // windows_x86_64_msvc crate) don't yet publish 3.14 wheels, and
  // `pip install -e .` falls back to source-build, which fails without
  // a Rust toolchain. install.ps1 sidesteps this by pinning to 3.11
  // via uv; until we add the same uv-managed Python pathway here, the
  // simplest fix is to refuse 3.14 detection and let the NSIS prereq
  // page offer to install 3.11 alongside.
  //
  // Strategy: probe in three passes, in order from most-precise to
  // least-precise, and ONLY use PATH lookup as a last resort after
  // confirming the candidate isn't the WindowsApps redirector.
  //
  //  Pass 1: PEP 514 registry — every standards-compliant Python
  //          installer registers itself at SOFTWARE\Python\PythonCore.
  //          The MS Store stub does NOT register here, so a hit means
  //          a real Python install. Versions are explicit so we
  //          inherently filter 3.14 out.
  //  Pass 2: Filesystem probe of standard install locations
  //          (Program Files, LocalAppData\Programs\Python). Same
  //          version filtering by directory name.
  //  Pass 3: PATH lookup of `py.exe` (the launcher itself never
  //          triggers the Store) — but call it with a version flag so
  //          we resolve to a SPECIFIC supported version, not whatever
  //          py.exe's default is (which on a 3.14-only box would be
  //          3.14).

  const SUPPORTED_VERSIONS = ['3.11', '3.12', '3.13']
  const SUPPORTED_VERSIONS_NO_DOT = ['311', '312', '313']

  // Pass 1: registry. Use `reg query` since main process doesn't have
  // a reliable in-process registry API across all electron versions.
  for (const hive of ['HKLM', 'HKCU']) {
    for (const version of SUPPORTED_VERSIONS) {
      try {
        const out = await execText(
          'reg',
          ['query', `${hive}\\SOFTWARE\\Python\\PythonCore\\${version}\\InstallPath`, '/ve', '/reg:64'],
          { timeout: 5_000 }
        )

        // Output format: "    (Default)    REG_SZ    C:\Path\To\Python\"
        const match = out.match(/REG_SZ\s+(.+?)\s*$/m)

        if (match) {
          const installPath = match[1].trim()
          const pythonExe = path.join(installPath, 'python.exe')

          if (fileExists(pythonExe)) {
            return pythonExe
          }
        }
      } catch {
        // Key not present — try next.
      }
    }
  }

  // Pass 2: filesystem probe of standard locations.
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
  const localAppData = process.env.LOCALAPPDATA || ''

  for (const versionDir of SUPPORTED_VERSIONS_NO_DOT) {
    const systemWide = path.join(programFiles, `Python${versionDir}`, 'python.exe')

    if (fileExists(systemWide)) {
      return systemWide
    }

    if (localAppData) {
      const perUser = path.join(localAppData, 'Programs', 'Python', `Python${versionDir}`, 'python.exe')

      if (fileExists(perUser)) {
        return perUser
      }
    }
  }

  // Pass 3: py.exe with explicit version flag. The launcher itself is
  // safe to invoke (no Store popup) and `py -3.13 -c "import sys;
  // print(sys.executable)"` resolves to the actual python.exe path of
  // the requested version. We try in version-priority order so the
  // first hit wins.
  const pyExe = findOnPath('py.exe')

  if (pyExe) {
    for (const version of SUPPORTED_VERSIONS) {
      try {
        const out = await execText(pyExe, [`-${version}`, '-c', 'import sys; print(sys.executable)'], {
          timeout: PROBE_TIMEOUT_MS
        })

        const candidate = out.trim()

        if (candidate && fileExists(candidate)) {
          return candidate
        }
      } catch {
        // py couldn't find that version — try next.
      }
    }
  }

  // We deliberately do NOT fall back to plain `python.exe` on PATH.
  // Without a way to verify the version safely (running `python -V`
  // risks the Microsoft Store popup), accepting whatever's there
  // could land us on 3.14 and trigger the Rust-build-from-source
  // failure. Better to return null and let the NSIS prereq page
  // offer to install a known-good 3.11 via winget.
  return null
}

function getVenvPython(venvRoot) {
  return path.join(venvRoot, IS_WINDOWS ? path.join('Scripts', 'python.exe') : path.join('bin', 'python'))
}

// resolveGitBinary — locate git.exe on Windows. A fresh installer-driven
// install only has PortableGit under %LOCALAPPDATA%\scout\git (never on
// PATH), so a bare spawn('git') ENOENTs and self-update checks fail with
// "Couldn't check for updates". PortableGit first, then UGit's bundled copy
// (see ./git-binary-candidates), then standard Git-for-Windows locations,
// then PATH. Cached after first probe.
let _gitBinaryCache = null

// A binary can exist on disk and still be unlaunchable — on macOS an
// Intel-only build ahead on PATH (e.g. a pre-Rosetta-removal Homebrew)
// fails at spawn time with errno -86 (EBADARCH), which callers then report
// as an update-server/network problem. Probing `git --version` before
// committing to a candidate skips such entries; the existence-only
// fallback keeps behaviour unchanged where the probe itself cannot run.
function binaryRuns(candidate) {
  try {
    execFileSync(candidate, ['--version'], {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true
    })

    return true
  } catch {
    return false
  }
}

function findPathCandidates(command) {
  const pathEntries = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)

  const candidates = []

  for (const entry of pathEntries) {
    const candidate = path.join(entry, command)

    if (fileExists(candidate)) {
      candidates.push(candidate)
    }
  }

  return candidates
}

function resolveGitBinary() {
  if (_gitBinaryCache) {
    return _gitBinaryCache
  }

  if (!IS_WINDOWS) {
    // Every PATH hit, probed — the first entry that merely exists can be
    // unlaunchable while a working system git sits later on the same PATH.
    const selected = selectRunnableBinary({
      candidates: findPathCandidates('git'),
      fileExists,
      binaryRuns
    })

    _gitBinaryCache = selected || 'git'

    return _gitBinaryCache
  }

  const localAppData = process.env.LOCALAPPDATA || ''

  // Fixed candidates + the UGit-bundled glob (a UGit install moves with every
  // app-* version, so it can only be found by enumerating the dir). UGit's
  // git.exe is usually on PATH, but an Explorer-launched Electron inherits the
  // login-time environment block and can miss it (#61494).
  const candidates = windowsGitCandidates(
    {
      localAppData,
      programFiles: process.env['ProgramFiles'] || 'C:\\Program Files',
      programFilesX86: process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    },
    { existsSync: fileExists, readdirSync: dir => fs.readdirSync(dir) }
  )

  _gitBinaryCache = candidates.find(fileExists) || findOnPath('git') || 'git'

  return _gitBinaryCache
}

// resolveGhBinary — locate the GitHub CLI. GUI-launched apps get a minimal PATH
// that omits Homebrew (/opt/homebrew/bin, /usr/local/bin) where `gh` usually
// lives, so a bare spawn('gh') ENOENTs even though `gh` works in the user's
// terminal. Check the common install locations first, then PATH. Cached.
let _ghBinaryCache = null

function resolveGhBinary() {
  if (_ghBinaryCache) {
    return _ghBinaryCache
  }

  const candidates = []

  if (IS_WINDOWS) {
    candidates.push(path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'))

    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'gh.exe'))
    }
  } else {
    const home = app.getPath('home')
    candidates.push('/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', path.join(home, '.local', 'bin', 'gh'))
    // PATH hits go through the same probe: a bare findOnPath fallback would
    // re-select an unlaunchable first hit when none of the fixed locations exist.
    candidates.push(...findPathCandidates('gh'))
  }

  // Same selection rule as git: an existing-but-unlaunchable candidate (e.g.
  // an Intel-only build from a stale Homebrew) must not shadow a working one
  // further down the list, and PATH is only consulted when none of the
  // explicit candidates is usable.
  const selected = selectRunnableBinary({
    candidates,
    fileExists,
    binaryRuns
  })

  _ghBinaryCache = selected || findOnPath('gh') || 'gh'

  return _ghBinaryCache
}

// ─── Self-update (git-pull against the running backend's scout root) ──────

function readDesktopUpdateConfig(): { branch: string; branchExplicit: boolean } {
  try {
    const parsed: { branch?: unknown } | null = JSON.parse(fs.readFileSync(DESKTOP_UPDATE_CONFIG_PATH, 'utf8'))
    const branch: string = typeof parsed?.branch === 'string' ? parsed.branch.trim() : ''

    return { branch: branch || DEFAULT_UPDATE_BRANCH, branchExplicit: branch.length > 0 }
  } catch {
    return { branch: DEFAULT_UPDATE_BRANCH, branchExplicit: false }
  }
}

// Atomic file write: temp + rename (atomic on all platforms). Prevents
// partial writes on crash/power loss that corrupt JSON config files.
function writeFileAtomic(targetPath, data, encoding?: BufferEncoding) {
  const tmp = targetPath + '.tmp'
  fs.writeFileSync(tmp, data, encoding)
  fs.renameSync(tmp, targetPath)
}

function writeDesktopUpdateConfig(config) {
  fs.mkdirSync(path.dirname(DESKTOP_UPDATE_CONFIG_PATH), { recursive: true })
  writeFileAtomic(DESKTOP_UPDATE_CONFIG_PATH, JSON.stringify(config, null, 2))
}

// ─── Main-window geometry persistence (window-state.json) ──────────────────

function readWindowState() {
  try {
    return sanitizeWindowState(JSON.parse(fs.readFileSync(DESKTOP_WINDOW_STATE_PATH, 'utf8')))
  } catch {
    return null
  }
}

// Persist the window's restored (non-maximized) bounds plus its maximized flag.
// getNormalBounds() keeps the pre-maximize size, so un-maximizing next session
// lands back where the user actually sized the window.
function persistWindowState() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) {
    return
  }

  try {
    const { x, y, width, height } = mainWindow.getNormalBounds()
    fs.mkdirSync(path.dirname(DESKTOP_WINDOW_STATE_PATH), { recursive: true })
    writeFileAtomic(
      DESKTOP_WINDOW_STATE_PATH,
      JSON.stringify({ x, y, width, height, isMaximized: mainWindow.isMaximized() }, null, 2)
    )
  } catch (err) {
    rememberLog(`[window-state] persist failed: ${err?.message || err}`)
  }
}

// move/resize fire many times mid-drag; debounce to one write.
const schedulePersistWindowState = debounce(persistWindowState, 250)

// Zoom's primary store is a main-process JSON file. The renderer localStorage
// mirror lives under Electron's cache/storage folders, which crash recovery
// can move or recreate — wiping the zoom setting exactly when the user just
// recovered from a crash (#56726). JSON survives; localStorage is kept as a
// secondary mirror so pre-JSON installs migrate transparently on first read.
const DESKTOP_ZOOM_STATE_PATH = path.join(app.getPath('userData'), 'zoom-state.json')

function readZoomState() {
  try {
    const raw = JSON.parse(fs.readFileSync(DESKTOP_ZOOM_STATE_PATH, 'utf8'))
    const level = Number(raw?.zoomLevel)

    return Number.isFinite(level) ? level : null
  } catch {
    return null
  }
}

function writeZoomState(zoomLevel) {
  try {
    fs.mkdirSync(path.dirname(DESKTOP_ZOOM_STATE_PATH), { recursive: true })
    writeFileAtomic(DESKTOP_ZOOM_STATE_PATH, JSON.stringify({ zoomLevel }, null, 2))
  } catch (error) {
    rememberLog(`[zoom] json persist failed: ${error?.message || error}`)
  }
}

// Match the backend's source resolution but bias toward a real git checkout.
// Dev → SOURCE_REPO_ROOT. Packaged/CLI install → ACTIVE_SCOUT_ROOT.
// SCOUT_DESKTOP_SCOUT_ROOT always wins so devs can pin a worktree.
function resolveUpdateRoot() {
  const candidates = [
    process.env.SCOUT_DESKTOP_SCOUT_ROOT && path.resolve(process.env.SCOUT_DESKTOP_SCOUT_ROOT),
    !IS_PACKAGED && isScoutSourceRoot(SOURCE_REPO_ROOT) ? SOURCE_REPO_ROOT : null,
    isScoutSourceRoot(ACTIVE_SCOUT_ROOT) ? ACTIVE_SCOUT_ROOT : null
  ].filter(Boolean)

  return candidates.find(isGitCheckout) || candidates[0] || ACTIVE_SCOUT_ROOT
}

function runGit(args, options: any = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const gitBinary = resolveGitBinary()
    const gitArgs = IS_WINDOWS ? ['-c', 'windows.appendAtomically=false', ...args] : args
    const host = IS_WINDOWS ? windowsGitHost(true) : null

    const plan = planNoConsoleGitSpawn({
      gitBin: gitBinary,
      args: gitArgs,
      isWindows: IS_WINDOWS,
      pythonBin: host?.pythonBin ?? null,
      scriptPath: host?.scriptPath ?? null,
      env: { ...process.env, ...((options.env || {}) as any), GIT_TERMINAL_PROMPT: '0' }
    })

    const child = spawn(
      plan.command,
      plan.args,
      hiddenWindowsChildOptions({
        cwd: options.cwd,
        env: plan.env,
        stdio: plan.stdio
      })
    )

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      const text = chunk.toString()
      stdout += text
      options.onLine?.('stdout', text)
    })
    child.stderr.on('data', chunk => {
      const text = chunk.toString()
      stderr += text
      options.onLine?.('stderr', text)
    })
    // A spawn-level failure means git itself never ran (missing, not
    // executable, wrong CPU architecture) — a local problem, not a network one.
    child.once('error', error => {
      const local = describeGitSpawnFailure(error, gitBinary)

      reject(local ? Object.assign(new Error(local), { kind: GIT_UNUSABLE, cause: error }) : error)
    })
    // 'close', not 'exit': exit can fire before the stdio pipes drain, and a
    // resolved-early `remote get-url` came back as "" often enough to route
    // passive checks down the wrong remote path.
    child.once('close', (code: number): void => resolve({ code, stdout, stderr }))
  })
}

function emitUpdateProgress(payload) {
  const merged = { stage: 'idle', message: '', percent: null, error: null, ...payload, at: Date.now() }
  rememberLog(`[updates] ${merged.stage}: ${merged.message || merged.error || ''}`)

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('scout:updates:progress', merged)
  }
}

// A dev run (`npm run dev`) works on a developer's git checkout: git owns it, never the updater,
// which would reset a diverged branch to origin and park the work behind a rescue ref.
async function checkUpdates(opts: { force?: boolean } = {}): Promise<UpdaterStatusWire> {
  if (DEV_SERVER) {
    return { supported: false, reason: 'dev-run', fetchedAt: Date.now() }
  }

  // A packaged install delegates to the update owner named by its stamp.
  let strategy: UpdaterStrategy | null = null

  try {
    strategy = await resolvePackagedUpdateStrategy()

    if (strategy) {
      return await strategy.check(opts)
    }
  } catch (error) {
    return {
      supported: true,
      mechanism: strategy?.mechanism,
      error: 'check-failed',
      message: error instanceof Error ? error.message : String(error),
      fetchedAt: Date.now()
    }
  }

  // Checkout install: dispatch through the strategy layer — one mechanism,
  // one stamp, no direct body path. The flow lives in updater/checkout.ts;
  // this is the only production door to the checkout arms.
  return resolveCheckoutUpdateStrategy().check(opts)
}

// ── bundled / App Installer helpers ─────────────────────────────────────────

/**
 * Keep the native updater instance alive across check, download and install.
 * Its identity comes from the packaged app, not its optional Python payload.
 */
const updateOperation: UpdateOperation = new UpdateOperation(createPackagedUpdateStrategy)

function resolvePackagedUpdateStrategy(): Promise<UpdaterStrategy | null> {
  return updateOperation.resolve()
}

async function createPackagedUpdateStrategy(): Promise<UpdaterStrategy | null> {
  const mechanism = resolveUpdaterMechanism({
    platform: process.platform,
    updateMechanism: INSTALL_STAMP?.updateMechanism,
    source: INSTALL_STAMP?.source
  })

  if (mechanism === 'windows-handoff' || mechanism === 'posix-handoff') {
    return null
  }

  if (INSTALL_STAMP?.channelBuild && (mechanism === 'electron-updater' || mechanism === 'app-installer')) {
    const build = INSTALL_STAMP.channelBuild
    const installed = await inspectRunningChannelApp(build)

    // Platform/arch/signing are the channel's own preconditions. The Python
    // payload is not: electron-updater swaps the .app without it, and the
    // darwin Light channel build ships none (write-build-stamp.mjs). The
    // strategy that consumes the payload (app-installer) demands it itself.
    if (
      (process.platform !== 'darwin' && process.platform !== 'win32') ||
      (process.arch !== 'arm64' && process.arch !== 'x64')
    ) {
      throw new Error('Channel updates require a supported packaged application')
    }

    return new ChannelStrategy({
      build,
      mechanism,
      resolver: new ChannelResolver({
        build,
        platform: process.platform,
        arch: process.arch,
        signer: installed.signer
      }),
      nativeFactory: (target: ChannelTarget): UpdaterStrategy => createNativePackagedStrategy(mechanism, target)
    })
  }

  return createNativePackagedStrategy(mechanism)
}

function createNativePackagedStrategy(
  mechanism: UpdaterStrategy['mechanism'],
  target?: ChannelTarget
): UpdaterStrategy {
  if (mechanism === 'electron-updater') {
    const deps: Parameters<typeof createMacStrategy>[0] = {
      channel: resolveUpdaterChannelFromStamp(),
      light: isLightVariant(),
      feedBaseUrl: resolveDesktopFeedBaseUrl(),
      appVersion: app.getVersion(),
      log: rememberLog,
      emitProgress: emitUpdateProgress,
      beforeInstall: teardownBundledBackend,
      onInstallFailure: restoreBundledBackend
    }

    return target ? createChannelMacStrategy(deps, target) : createMacStrategy(deps)
  }

  if (mechanism === 'app-installer') {
    const payload: PayloadInfo = requireBundledPayload(mechanism)

    const deps: ConstructorParameters<typeof AppInstallerStrategy>[0] = {
      python: payload.storePython,
      // The checker ships inside the payload's repo snapshot (git archive of
      // the committed tree): <payload>/<repo>/apps/desktop/scripts/.
      script: path.join(payload.repoDir, 'apps', 'desktop', 'scripts', 'check-appinstaller-update.py'),
      run: (python, script) =>
        runAppInstallerChecker(python, script, {
          env: { ...process.env, PYTHONPATH: payload.sitePackages },
          onStderr: stderr => console.error(`[app-installer] checker stderr: ${stderr.slice(0, 400)}`)
        }),
      channel: resolveUpdaterChannelFromStamp(),
      light: isLightVariant(),
      feedBaseUrl: resolveDesktopFeedBaseUrl(),
      installer: {
        prepare: url => stageAppInstallerFile(url, path.join(app.getPath('userData'), 'updates')),
        open: file => shell.openPath(file)
      },
      teardownBundledBackend,
      restoreBundledBackend,
      emitUpdateProgress,
      appVersion: INSTALL_STAMP?.channelBuild?.windowsVersion ?? app.getVersion(),
      quit: () => app.quit(),
      registerPendingRelaunch: (fromVersion: string): Promise<RelaunchRegistration> =>
        registerUpdateRelaunch(app, fromVersion, {
          // The relaunch mechanism: a detached waiter, external to the dying
          // process. It snapshots the OLD package, signals the handshake,
          // waits for this process to exit and for the OS to swap the
          // installed package version, then activates the NEW package.
          // Electron's app.relaunch would re-execute the OLD package's
          // binary and can hold the swap open, so it is not used. The
          // script is staged to a temp dir and resolved absolutely so
          // nothing inherited from the package holds the swap open.
          relaunch: () =>
            startRelaunchWaiter({
              processId: process.pid,
              processStartTimeMs: Math.round(Date.now() - process.uptime() * 1000),
              identityName: PRODUCT_IDENTITY.msixAppIdWithOrg,
              scriptPath: path.join(payload.repoDir, 'apps', 'desktop', 'scripts', 'update-relaunch-waiter.ps1')
            })
        })
    }

    return target
      ? createChannelAppInstallerStrategy(deps, target, verifyPreparedChannelInstaller)
      : new AppInstallerStrategy(deps)
  }

  if (mechanism === 'microsoft-store') {
    const payload: PayloadInfo = requireBundledPayload(mechanism)

    return createStoreStrategy({
      python: payload.storePython,
      script: path.join(payload.repoDir, 'apps', 'desktop', 'scripts', 'check-store-update.py'),
      sitePackages: payload.sitePackages,
      env: process.env,
      windowHandle: () => (BrowserWindow.getFocusedWindow() ?? mainWindow)?.getNativeWindowHandle() ?? null,
      appVersion: app.getVersion(),
      teardown: teardownBundledBackend,
      restore: restoreBundledBackend,
      emitProgress: emitUpdateProgress,
      quit: () => app.quit(),
      registerPendingRelaunch: (fromVersion: string): Promise<RelaunchRegistration> =>
        registerUpdateRelaunch(app, fromVersion, {
          relaunch: () =>
            startRelaunchWaiter({
              processId: process.pid,
              processStartTimeMs: Math.round(Date.now() - process.uptime() * 1000),
              identityName: PRODUCT_IDENTITY.storeMsix!.identityName,
              scriptPath: path.join(payload.repoDir, 'apps', 'desktop', 'scripts', 'update-relaunch-waiter.ps1'),
              timeoutSeconds: 1860
            })
        })
    })
  }

  return new ExternalStrategy(INSTALL_STAMP)
}

/**
 * The bundled Python payload for a strategy whose update check runs inside
 * it. A stamp that names such a mechanism without a payload is a broken
 * install; say so instead of failing on `payload.storePython`.
 */
function requireBundledPayload(mechanism: UpdaterStrategy['mechanism']): PayloadInfo {
  const payload: PayloadInfo | null = bundledPayload(process.resourcesPath)

  if (!payload) {
    throw new Error(`${mechanism} updates require the bundled application payload, which this install has none of`)
  }

  return payload
}

/**
 * The checkout updater strategy (windows-handoff / posix-handoff). The flow
 * lives in updater/checkout.ts; this is the composition root that hands it
 * the app shell's impure edges. The public checkUpdates/applyUpdates
 * entrypoints dispatch only through this strategy — there is no other
 * production path to the checkout arms.
 */
function resolveCheckoutUpdateStrategy(): UpdaterStrategy {
  return createCheckoutStrategy({
    scoutHome: SCOUT_HOME,
    isWindows: IS_WINDOWS,
    isMac: IS_MAC,
    defaultUpdateBranch: DEFAULT_UPDATE_BRANCH,
    updateHandoffDwellMs: UPDATE_HANDOFF_DWELL_MS,
    readSourceUpdate: async (updateRoot: string, opts: { force?: boolean }): Promise<SourceUpdate | null> =>
      readSourceUpdate({
        python: await findPythonForRoot(updateRoot),
        git: resolveGitBinary(),
        updateRoot,
        scoutHome: SCOUT_HOME,
        branchConfigPath: DESKTOP_UPDATE_CONFIG_PATH,
        force: opts.force
      }),
    resolveUpdateRoot,
    resolveUpdaterBinary,
    remoteGatewayActive: globalRemoteActive,

    emitUpdateProgress,
    rememberLog,
    startScout,
    stopBackendsForUpdate,
    repairMacUpdaterHelper,
    preflightStateDb: async (home: string, log: (message: string) => void): Promise<void> => {
      const root: string = resolveUpdateRoot()

      // `updates.pre_update_backup: off` is the CLI's opt-out for the whole
      // pre-update backup family; the Desktop's emergency snapshot honours it
      // too (4de06d1dbf7b). An unreadable answer keeps the snapshot.
      if (
        !(await readPreUpdateBackupEnabled(
          resolveScoutBackend(['config', 'get', 'updates.pre_update_backup', '--json']),
          home
        ))
      ) {
        log('[updates] emergency state.db backup disabled by updates.pre_update_backup')

        return
      }

      // PM-managed checkouts carry no venv of their own: the installation
      // launcher owns interpreter and generation selection there — same
      // contract as readSourceUpdate and the hand-off script.
      const managed: boolean = directoryExists(path.join(root, 'pm'))

      const launcher: string | null = managed ? resolveInstallationLauncher(root, IS_WINDOWS, SCOUT_HOME) : null

      if (managed && !launcher) {
        const message =
          `state.db pre-flight failed: the installation launcher under ${root} is missing. ` +
          'Update cancelled before backend shutdown. Repair this installation before retrying.'

        log(`[updates] ${message}`)
        throw new Error(message)
      }

      preflightStateDb({
        python: managed ? null : await findPythonForRoot(root),
        launcher,
        script: path.join(root, 'scout_backend', 'backup_sqlite.py'),
        home,
        log
      })
    },
    runningAppBundle,
    markQuittingForHandoff: () => {
      isQuittingForHandoff = true
    },
    quit: () => app.quit()
  })
}

/**
 * The App Installer feed base URL for a bundled MSIX install: config.yaml's
 * `updates.desktop_feed_base_url`, else Windows' registered App Installer
 * source.
 */
function resolveDesktopFeedBaseUrl(): string {
  return resolveFeedBaseUrl(readUpdatesFeedBaseFromConfig(path.join(SCOUT_HOME, 'config.yaml')))
}

/** The updater channel from the baked install stamp ('canary' vs 'stable'). */
function resolveUpdaterChannelFromStamp(): string {
  return packagedReleaseChannel(INSTALL_STAMP) ?? 'stable'
}

/** True when this artifact is the light (remote-only) variant. */
function isLightVariant(): boolean {
  return INSTALL_STAMP?.payload === 'light'
}

/** Invalidate connections and wait for every owned backend before the swap. */
async function teardownBundledBackend(): Promise<void> {
  isQuittingForHandoff = true

  const results = await Promise.allSettled([teardownPrimaryBackendAndWait(backendTeardownOptions('reconnect'))])

  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)

  if (errors.length) {
    // An incomplete shutdown blocks replacement until a retry proves exit.
    backendStartFailure = new AggregateError(errors, 'Backend shutdown failed')
    throw backendStartFailure
  }
}

async function restoreBundledBackend(): Promise<void> {
  try {
    // A failed stop retains its process handle. Retry before enabling a new start.
    await teardownBundledBackend()
  } finally {
    isQuittingForHandoff = false
  }

  backendStartFailure = null
  await startScout()
}

// Set to true when the desktop is about to quit so a detached swap/install/
// uninstall script can take over. On macOS, app.quit() closes windows but
// window-all-closed deliberately keeps the process alive (standard Electron
// macOS convention). Without this flag the process never exits — the detached
// hand-off script spins its PID-wait for the full timeout, and the user sees a
// blank app with no window (and an uninstall that appears to do nothing). When
// set, window-all-closed calls app.quit() on every platform so the process
// actually dies and the hand-off script can proceed immediately.
let isQuittingForHandoff = false

// Quit-guard latches: one while the confirmation is on screen (a second
// Cmd-Q must not stack dialogs), one after the user has said "quit anyway"
// (the app.quit() that follows re-enters before-quit and must pass through).
let quitPromptOpen = false
let quitConfirmedWithActiveWork = false

// Resolve the staged updater binary the desktop may hand an update to. On
// Windows that binary owns ALL repo mutation — running `scout update` +
// rebuilding the desktop — so the desktop never touches its own bits while
// running. macOS/Linux stage the same binary but deliberately do not use it;
// see resolveStagedUpdaterBinary for the policy and for #74836. Returns null
// whenever no hand-off applies; callers degrade gracefully.
function resolveUpdaterBinary() {
  return resolveStagedUpdaterBinary(SCOUT_HOME, { fileExists, isWindows: IS_WINDOWS })
}

function repairMacUpdaterHelper(updater) {
  if (!IS_MAC || !updater) {
    return
  }

  try {
    execFileSync('/usr/bin/xattr', ['-cr', updater], { stdio: 'ignore' })
  } catch (err) {
    rememberLog(`[updates] macOS updater helper quarantine repair skipped: ${err.message}`)
  }

  try {
    execFileSync('/usr/bin/codesign', ['--verify', updater], { stdio: 'ignore' })

    return
  } catch {
    // Unsigned or invalid helper. Apply a local ad-hoc signature so Gatekeeper
    // does not block the staged updater before it can run.
  }

  try {
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', updater], { stdio: 'ignore' })
    rememberLog('[updates] repaired macOS updater helper signature')
  } catch (err) {
    rememberLog(`[updates] macOS updater helper signature repair skipped: ${err.message}`)
  }
}

// Path to the venv shim whose lock decides whether `scout update` can write
// fresh entry points. On Windows this is the file the running backend
// `scout.exe` holds open; on POSIX it's never mandatory-locked.
function venvScoutShimPath(updateRoot) {
  const venvDir = resolveVenvDir(updateRoot)

  return IS_WINDOWS ? path.join(venvDir, 'Scripts', 'scout.exe') : path.join(venvDir, 'bin', 'scout')
}

// Best-effort lock probe mirroring the Rust updater's is_locked(): a running
// .exe on Windows refuses an O_RDWR open with a sharing violation. On POSIX
// this practically always succeeds (no mandatory locking), so it returns false
// — correct, since the shim-contention brick is Windows-only.
function isShimLocked(shimPath) {
  if (!IS_WINDOWS) {
    return false
  }

  let fd

  try {
    fd = fs.openSync(shimPath, 'r+')

    return false
  } catch (err) {
    // ENOENT ⇒ not there ⇒ nothing locking it. Anything else (EBUSY/EPERM/
    // EACCES) on Windows means a live handle holds it.
    return err && err.code !== 'ENOENT'
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        void 0
      }
    }
  }
}

// Kill only Scout-OWNED venv daemons (the memory plugin's hindsight daemon:
// exe under venv\Scripts AND cmdline referencing hindsight_api.main). The
// daemon is spawned DETACHED, so it outlives the backend tree-kill and keeps
// venv files mapped. External holders (a user terminal running `scout`,
// unrelated scripts) are NOT killed. The uninstall lock probe refuses a
// held installation. Selection lives in the pure
// venv-holder-select module (ordinal path-prefix, no PowerShell -like
// wildcard hazards) so it's testable without Electron.
function scanWindowsProcesses(): Array<{ ProcessId?: unknown; ExecutablePath?: string; CommandLine?: string }> {
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.CommandLine } | Select-Object ProcessId, ExecutablePath, CommandLine | ConvertTo-Json -Compress'
    ],
    hiddenWindowsChildOptions({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 })
  )

  const parsed = JSON.parse(String(out || '[]'))

  return Array.isArray(parsed) ? parsed : [parsed]
}

function killScoutOwnedVenvDaemons(updateRoot) {
  if (!IS_WINDOWS) {
    return
  }

  const scriptsDir = path.join(resolveVenvDir(updateRoot), 'Scripts')

  let holders = []

  try {
    holders = scanWindowsProcesses().filter(p => isScoutOwnedVenvDaemon(p?.ExecutablePath, p?.CommandLine, scriptsDir))
  } catch {
    // Best-effort: the uninstall lock probe remains the backstop.
    return
  }

  for (const holder of holders) {
    const pid = Number(holder?.ProcessId)

    if (Number.isInteger(pid) && pid > 0) {
      rememberLog(`[updates] stopping Scout-owned venv daemon (hindsight) PID ${pid} before hand-off`)

      try {
        forceKillProcessTree(pid)
      } catch (error) {
        // Update hand-off only. Close/stop must not swallow this; see
        // windowsCloseStopOwnedBackends.
        rememberLog(`[updates] taskkill PID ${pid} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}

// Kill EXTERNAL Scout processes that hold this install's venv shim (#62311):
// the gateway Startup item and dashboard Scheduled Task are launched outside
// this app (Task Scheduler / autostart), so the backend teardown above never
// sees them — yet they map venv files and made every update hand-off abort
// with "venv shim still locked". Selection is deliberately narrow
// (isExternalVenvHolder: exe under venv\Scripts AND unambiguously a Scout
// program) — unrelated processes that merely mention the install root or use
// the venv interpreter for their own scripts are never killed; the shim-lock
// probe still aborts the hand-off for those. Called before the release gate
// AND inside each gate pass, so a respawning autostart holder is re-killed
// instead of winning the 15s race.
function killExternalVenvHolders(updateRoot) {
  if (!IS_WINDOWS) {
    return
  }

  const scriptsDir = path.join(resolveVenvDir(updateRoot), 'Scripts')

  let holders = []

  try {
    holders = scanWindowsProcesses().filter(p => isExternalVenvHolder(p?.ExecutablePath, p?.CommandLine, scriptsDir))
  } catch {
    // Best-effort: the shim-lock probe remains the backstop.
    return
  }

  for (const holder of holders) {
    const pid = Number(holder?.ProcessId)

    if (Number.isInteger(pid) && pid > 0) {
      rememberLog(
        `[updates] stopping external Scout venv holder (autostart gateway/dashboard) PID ${pid} before hand-off`
      )

      try {
        forceKillProcessTree(pid)
      } catch (error) {
        rememberLog(`[updates] taskkill PID ${pid} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}

// Force-kill the entire process TREE rooted at each PID. Node's child.kill()
// only signals the direct child, so on Windows a backend `scout.exe` that
// spawned its own grandchildren (a `scout` REPL, a pty terminal session, the
// gateway) would survive and keep the venv shim locked. taskkill /T /F reaps
// the whole tree synchronously. The command is not widened: one owned PID,
// /T /F, nothing else. Failures propagate — close/stop must not discard them.
// Windows-only: this is called solely from the Windows shim-unlock and
// close/stop paths, and the backend is NOT spawned detached (so it's not a
// process-group leader — a POSIX negative-pgid kill would be meaningless
// here anyway). POSIX teardown stays with the existing before-quit SIGTERM.
function forceKillProcessTree(pid) {
  if (!IS_WINDOWS) {
    return
  }

  if (!Number.isInteger(pid) || pid <= 0) {
    return
  }

  execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], hiddenWindowsChildOptions({ stdio: 'ignore' }))
}

// Stop app-owned Windows backends before replacing application outputs.
// PM generations can retain live readers. Gateway draining/restart belongs to
// `scout update`; neither venv scans nor a second fleet stop belong here.
async function stopBackendsForUpdate(): Promise<void> {
  if (IS_WINDOWS) {
    await teardownPrimaryBackendAndWait(backendTeardownOptions('reconnect'))
  }
}

// Uninstall still deletes the installation and its historical venv. Unlike
// generation updates, deletion must wait for those old files to be released.
async function releaseBackendLock(updateRoot: string, tag: string): Promise<{ unlocked: boolean }> {
  if (!IS_WINDOWS) {
    return { unlocked: true }
  }

  const scoutProcess = backendConnectionState.getProcess()

  // Seed the release gate with every PID we are about to signal: the
  // supervised primary backend and all pool backends. The gate waits for
  // these to actually LEAVE the process table, not just for the shim to
  // unlock — the shim probe only covers venv\Scripts\scout.exe, but the
  // backend is `python.exe -m scout_backend.main serve`, which need not hold
  // the shim at all (#74805 first-attempt race).
  const initialPids = []

  if (scoutProcess && Number.isInteger(scoutProcess.pid)) {
    initialPids.push(scoutProcess.pid)
  }

  // No backend comes back after an uninstall: stay silent, like a quit.
  await teardownPrimaryBackendAndWait(backendTeardownOptions('quit'))

  // Uninstall deletes the whole runtime. Drain separately-running gateways
  // through the CLI, rather than targeting a gateway worker by PID.
  stopGatewayBeforeUpdate(venvScoutShimPath(updateRoot), SCOUT_HOME)

  // Reap Scout-OWNED venv daemons the tree-kill above cannot reach: the
  // memory plugin's hindsight daemon is spawned DETACHED (it outlives the
  // backend) yet runs off venv\Scripts\pythonw.exe, keeping venv files
  // mapped past the backend teardown (#75477/#75478). Narrowly scoped
  // (venv-holder-select) — external holders are never killed here.
  killScoutOwnedVenvDaemons(updateRoot)

  // External autostart Scout processes (gateway Startup item, dashboard
  // Scheduled Task) also hold the venv shim and are invisible to the backend
  // teardown (#62311). Kill them before the gate AND re-scan inside each gate
  // pass, so a respawning holder loses the race instead of the update.
  killExternalVenvHolders(updateRoot)

  const shim = venvScoutShimPath(updateRoot)

  const gate = await waitForBackendRelease(
    initialPids,
    {
      isShimLocked: () => Boolean(isShimLocked(shim)),
      isPidAlive: isPidAliveWindows,
      collectStragglerPids: () => {
        // Re-kill resurgent external holders (autostart gateway/dashboard) on
        // every pass — #62311 — before collecting the desktop-owned stragglers.
        killExternalVenvHolders(updateRoot)
        const stragglers = []

        const currentScoutProcess = backendConnectionState.getProcess()

        if (currentScoutProcess && Number.isInteger(currentScoutProcess.pid)) {
          stragglers.push(currentScoutProcess.pid)
        }

        return stragglers
      },
      killProcessTree: pid => {
        try {
          forceKillProcessTree(pid)
        } catch (error) {
          rememberLog(`[${tag}] taskkill PID ${pid} failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
      sleep: (ms: number) => new Promise(r => setTimeout(r, ms)),
      now: () => Date.now(),
      log: rememberLog
    },
    tag
  )

  if (gate.unlocked) {
    return { unlocked: true }
  }

  // Do NOT proceed past a held lock: handing off to the updater while another
  // process (a second desktop window, a user terminal, an unkillable child)
  // still maps the venv's files guarantees a half-updated venv — the updater's
  // dependency sync dies on access-denied partway through uninstalls, leaving
  // imports broken (the July 2026 brotlicffi/_sodium.pyd incidents). Failing
  // the update loudly and keeping the app running is strictly better than a
  // bricked install that needs manual venv surgery.
  rememberLog(
    `[${tag}] venv shim still locked after 15s; aborting hand-off (something outside this app holds the venv)`
  )

  return { unlocked: false }
}

// applyUpdates — hand off to the installer's --update flow, then exit.
//
// The desktop is a pure consumer: it does NOT git pull / pip install / rebuild
// itself (the old open-coded git dance lived here and drifted from
// `scout update`). Instead we spawn the staged Scout-Setup binary with
// --update and quit, so it can run `scout update` (which refuses while we
// hold the venv shim) and rebuild the desktop with our exe already gone.
//
// Detection (checkUpdates / commit changelog / "N behind") stays in the UI;
// only this apply action changed.
async function applyUpdates(): Promise<UpdaterApplyResultWire> {
  if (DEV_SERVER) {
    return { ok: false, error: 'dev-run', message: 'Updates are off in a development run; use git.' }
  }

  return updateOperation.apply(async (): Promise<UpdaterApplyResultWire> => {
    const packaged: UpdaterStrategy | null = await resolvePackagedUpdateStrategy()

    return (packaged ?? resolveCheckoutUpdateStrategy()).apply()
  })
}

// The running app's .app bundle (packaged macOS): execPath is
// <App>.app/Contents/MacOS/<exe>; climb three levels to the bundle root.
function runningAppBundle() {
  if (!IS_MAC) {
    return null
  }

  let dir = path.dirname(app.getPath('exe')) // .../Contents/MacOS

  for (let i = 0; i < 2; i++) {
    dir = path.dirname(dir)
  } // -> .../X.app

  return dir.endsWith('.app') ? dir : null
}

// macOS/Linux update hand-off: spawn the repo-owned posix orchestrator
// (scripts/desktop-update/posix.sh) detached and QUIT. The script waits us
// out, runs `scout update`, swaps/relaunches the app bundle, and writes
// .scout-update-result.json for the relaunched Desktop to surface. It shows
// its own tiny shim window (or nothing, headless) — this process only needs
// to leave. Checkouts that predate the script get the manual card once.
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

// Bootstrap-complete marker helpers. The marker is written by whichever
// installer ran: install.ps1, install.sh, the Rust bootstrap installer, or the
// first-launch bootstrap runner. It is provenance ("a bootstrap finished
// here"), NOT the launch gate -- activeRuntimeState() decides that, because a
// healthy runtime can predate the marker or outlive a repair that cleared it.
//
// Marker schema (version 1):
//   {
//     schemaVersion: 1,
//     pinnedCommit: "<40-char SHA>",       // what install.ps1 was driven against
//     pinnedBranch: "<branch name>" | null,
//     completedAt:  "<ISO 8601>",
//     desktopVersion: "<app.getVersion()>"  // for forensics
//   }
function readBootstrapMarker() {
  return readJson(BOOTSTRAP_COMPLETE_MARKER)
}

// Marker-independent: is the canonical install at ACTIVE_SCOUT_ROOT actually
// runnable right now? A complete CLI install (`install.sh --include-desktop`)
// or a DMG launch over a prior CLI install satisfies this WITHOUT the desktop
// ever having written the bootstrap marker -- so we must be able to recognise
// "already installed" off the filesystem alone, not just the marker.
async function isSourceRuntimeUsable(root: string): Promise<boolean> {
  return (await resolveSourceInstallationBackend(root, [], { scoutHome: SCOUT_HOME })) !== null
}

function isActiveRuntimeUsable(): Promise<boolean> {
  return isSourceRuntimeUsable(ACTIVE_SCOUT_ROOT)
}

function activeRuntimeState(backend: SourceBackend | null): ActiveRuntimeState {
  // We DELIBERATELY do NOT verify that the checkout is currently at the
  // pinned commit -- users update via the in-app update path or `scout
  // update`, which moves HEAD legitimately. The marker only attests "a
  // desktop-managed bootstrap ran here at least once"; runtime usability is
  // what decides whether we can actually launch.
  const state: ActiveRuntimeState = classifyActiveRuntime(
    readBootstrapMarker(),
    BOOTSTRAP_MARKER_SCHEMA_VERSION,
    backend !== null
  )

  // The canonical install stamp (written next to the runtime by the bootstrap)
  // tells the UI where this runtime came from. Prefer it over the marker so
  // the Runtime row reflects the actual install provenance.
  state.canonicalInstallStamp = readCanonicalInstallStamp()

  return state
}

/** Read the checkout-owned install stamp in the canonical runtime root
 *  (`ACTIVE_SCOUT_ROOT/install-stamp.json`), written by the Python
 *  completion tail. Returns null when absent or unreadable. */
function readCanonicalInstallStamp() {
  try {
    const raw = fs.readFileSync(path.join(ACTIVE_SCOUT_ROOT, 'install-stamp.json'), 'utf8')
    const parsed = JSON.parse(raw)

    if (parsed && typeof parsed === 'object' && typeof parsed.source === 'string') {
      return parsed
    }

    return null
  } catch {
    return null
  }
}

function resolveWebDist() {
  const override = process.env.SCOUT_DESKTOP_WEB_DIST

  if (override && directoryExists(path.resolve(override))) {
    return path.resolve(override)
  }

  const unpackedDist = path.join(unpackedPathFor(APP_ROOT), 'dist')

  if (directoryExists(unpackedDist)) {
    return unpackedDist
  }

  // Final fallback: APP_ROOT/dist. When packaged with asar:true this lives
  // INSIDE app.asar — not a servable filesystem directory — so the embedded
  // dashboard backend 404s on static routes (see #41327, #39472). The durable
  // fix is unpacking dist/ (PR #41411 adds dist/** to asarUnpack so the tier-2
  // unpackedDist above resolves). If we still land here while packaged, log it
  // so the cause isn't silent.
  const fallback = path.join(APP_ROOT, 'dist')

  // existsSync, not directoryExists: a stat inside app.asar constructs the deprecated fs.Stats (#96857).
  if (IS_PACKAGED && /app\.asar(?=$|[\\/])/.test(fallback) && !fs.existsSync(fallback)) {
    rememberLog(
      `[web-dist] dashboard frontend dir resolved to an asar-internal path that ` +
        `is not a real directory: ${fallback}. Static routes will 404. ` +
        `Ensure dist/** is unpacked (asarUnpack) or set SCOUT_DESKTOP_WEB_DIST.`
    )
  }

  return fallback
}

// Same resolution as resolveRendererIndex, but also hands back the missing
// asset list already computed for the copy it chose. The primary-window path
// needs BOTH, and re-deriving the list means walking the whole renderer
// generation a second time: missingRendererAssets follows index.html's
// modulepreload refs and then every chunk's inline __vite__mapDeps table, so
// on a release build it reads ~28 MiB across ~160 files synchronously on the
// main thread — measured ~49 ms per walk, twice before loadWindowUrl().
// Callers that only need the path keep using resolveRendererIndex below.
function resolveRendererIndexWithMissing(): { index: string; missing: string[] } {
  const asarIndex = path.join(APP_ROOT, 'dist', 'index.html')
  const webDistIndex = path.join(resolveWebDist(), 'index.html')

  // A packaged build ships dist/ twice: inside app.asar AND — because
  // asarUnpack lists dist/** — beside it in app.asar.unpacked. Prefer the
  // unpacked tree, matching the resolveWebDist()/unpackedPathFor precedent:
  // it is the copy the embedded dashboard serves and the copy a repair
  // rewrites, while pointing the window at the asar-internal index.html is
  // exactly how lazy chunks end up fetched from a path that cannot serve
  // them (#93479). Every window loader shares this resolver (main, overlay,
  // quick), so the ordering fix covers all of them. Dev is unchanged:
  // unpackedPathFor is a no-op outside an asar, so both candidates collapse
  // to APP_ROOT/dist and the original order is preserved.
  const candidates = IS_PACKAGED ? [webDistIndex, asarIndex] : [asarIndex, webDistIndex]
  const present = presentRendererIndexes(candidates)

  // index.html and the hashed chunks it names are one generation. An update
  // that replaces only one of the two shipped copies (app.asar vs
  // app.asar.unpacked) leaves a TORN copy: the window loads, then dies on the
  // first lazy import with "Failed to fetch dynamically imported module" and
  // every restart reloads the same torn copy. Prefer a copy whose modules are
  // all present, so the intact generation heals the boot by itself.
  // Remember the FIRST candidate's list: if every copy turns out to be torn we
  // load present[0], and its list is already in hand — recomputing it there
  // would reintroduce the very second walk this function exists to avoid.
  let firstMissing: string[] | null = null

  for (const candidate of present) {
    const missing = missingRendererAssets(candidate)

    if (missing.length === 0) {
      return { index: candidate, missing: [] }
    }

    if (firstMissing === null) {
      firstMissing = missing
    }

    rememberLog(
      `[renderer] skipping torn renderer bundle at ${candidate}: ` +
        `${missing.length} module file(s) named by index.html are missing ` +
        `(${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''})`
    )
  }

  if (present.length > 0) {
    // Every copy is torn. Load the first one anyway — the boundary's error is
    // still better than a blank window — but say what is wrong and how to fix
    // it, because no amount of restarting repairs a torn bundle.
    rememberLog(
      `[renderer] every renderer bundle is incomplete (${present.join(', ')}). ` +
        `The last update replaced the app while its files were locked. ` +
        `Repair with: scout desktop --force-build`
    )

    // present[0]'s own list, captured on the first loop iteration — never the
    // last candidate's, which would describe a bundle we are not loading.
    return { index: present[0], missing: firstMissing ?? [] }
  }

  // Nothing on disk. A packaged build with no renderer bundle blank-pages with
  // a bare ERR_FILE_NOT_FOUND and no clue why (see #39484). Surface the cause
  // and the fix before Electron loads the missing file.
  rememberLog(
    `[renderer] index.html not found — the desktop app was packaged without a ` +
      `renderer bundle. Tried: ${candidates.join(', ')}. ` +
      `Rebuild with: scout desktop --force-build`
  )

  return { index: candidates[0], missing: [] }
}

// Path-only accessor: unchanged behaviour for the window loaders that do not
// need the torn-asset list.
function resolveRendererIndex() {
  return resolveRendererIndexWithMissing().index
}

// True when `dir` lives inside the packaged app bundle / install tree.
// Packaged Electron's process.cwd() (and npm's INIT_CWD when dev tooling
// leaked into a release build) often resolve here — e.g. win-unpacked on
// Windows — which is exactly where PR #37536 item 16 said we must NOT run.
function isPackagedInstallPath(dir) {
  return isPackagedInstallPathUnderRoots(dir, {
    isPackaged: IS_PACKAGED,
    installRoots: [
      APP_ROOT,
      path.dirname(process.execPath),
      resolveRemovableAppPath(process.execPath, process.platform, process.env)
    ]
  })
}

function resolveScoutCwd() {
  // In a packaged build, `process.cwd()` resolves to the install root (e.g.
  // `…/win-unpacked` on Windows or `/Applications/Scout.app/Contents/...`
  // on macOS). Sessions spawned there leave files inside the app bundle
  // and bewilder users when "where did my files go?" is the install dir.
  // The user-configurable default project directory wins over everything,
  // followed by env hints (only honored when packaged if they point at a
  // real directory), then the home dir.
  const candidates = [
    readDefaultProjectDir(),
    process.env.SCOUT_DESKTOP_CWD,
    IS_PACKAGED ? null : process.env.INIT_CWD,
    IS_PACKAGED ? null : process.cwd(),
    !IS_PACKAGED ? SOURCE_REPO_ROOT : null,
    app.getPath('home')
  ]

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    const resolved = path.resolve(String(candidate))

    if (isPackagedInstallPath(resolved)) {
      continue
    }

    if (directoryExists(resolved)) {
      return resolved
    }
  }

  return app.getPath('home')
}

function sanitizeWorkspaceCwd(cwd) {
  const trimmed = typeof cwd === 'string' ? cwd.trim() : ''

  if (!trimmed || isPackagedInstallPath(trimmed)) {
    return { cwd: resolveScoutCwd(), sanitized: Boolean(trimmed) }
  }

  try {
    const resolved = path.resolve(trimmed)

    if (directoryExists(resolved)) {
      return { cwd: resolved, sanitized: false }
    }
  } catch {
    // Fall through to the resolved default.
  }

  return { cwd: resolveScoutCwd(), sanitized: Boolean(trimmed) }
}

// Persisted "Default project directory" — surfaced as a setting in the
// renderer (see app/settings/sessions-settings.tsx). Stored as JSON in
// userData so it survives self-updates without bleeding into the new
// install. `null` means "no preference, fall back to the usual chain".
const DEFAULT_PROJECT_DIR_CONFIG_FILENAME = 'project-dir.json'

function defaultProjectDirConfigPath() {
  return path.join(app.getPath('userData'), DEFAULT_PROJECT_DIR_CONFIG_FILENAME)
}

function readDefaultProjectDir() {
  try {
    const raw = fs.readFileSync(defaultProjectDirConfigPath(), 'utf8')
    const parsed = JSON.parse(raw)

    if (parsed && typeof parsed.dir === 'string' && parsed.dir.trim()) {
      const resolved = path.resolve(parsed.dir)

      if (directoryExists(resolved)) {
        return resolved
      }
    }
  } catch {
    // Missing / unreadable / malformed → fall through to the rest of the
    // candidate chain.
  }

  return null
}

function writeDefaultProjectDir(dir) {
  const target = defaultProjectDirConfigPath()
  const payload = dir ? JSON.stringify({ dir: path.resolve(dir) }, null, 2) : JSON.stringify({}, null, 2)

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, payload, 'utf8')
  } catch (error) {
    rememberLog(`[settings] write default project dir failed: ${error.message}`)
  }
}

const installedRuntimeGate = createInstalledRuntimeGate(process.env, rememberLog)

async function resolveScoutBackend(backendArgs: string[]): Promise<ResolvedScoutBackend> {
  const payload = bundledPayload(process.resourcesPath)

  if (payload) {
    if (!IS_WINDOWS) {
      provisionCliLinks(payload.commands, path.join(os.homedir(), '.local', 'bin'), rememberLog)
    }

    return {
      kind: 'python',
      label: `bundled payload at ${payload.root}`,
      command: payload.shim,
      args: [...backendArgs],
      env: { ...buildDesktopBackendEnv(), SCOUT_RUNTIME_DIR: payload.toolsDir },
      root: payload.repoDir,
      bootstrap: false,
      shell: false,
      local: 'bundled'
    }
  }

  // 1. Explicit override -- SCOUT_DESKTOP_SCOUT_ROOT points at a developer
  //    checkout. Honour it as-is (no bootstrap; the user is driving).
  const overrideRoot: string | undefined =
    process.env.SCOUT_DESKTOP_SCOUT_ROOT && path.resolve(process.env.SCOUT_DESKTOP_SCOUT_ROOT)

  if (overrideRoot && isScoutSourceRoot(overrideRoot)) {
    const backend: SourceBackend | null = createSourcePythonBackend(
      overrideRoot,
      await findPythonForRoot(overrideRoot),
      backendArgs
    )

    if (backend) {
      return backend
    }
  }

  // 2. Development source -- when running `npm run dev` from a checkout, the
  //    cloned repo at SOURCE_REPO_ROOT takes precedence over ACTIVE and any
  //    installed `scout` on PATH so local Python edits are actually exercised.
  //    (In dev with no checkout, SOURCE_REPO_ROOT won't pass isScoutSourceRoot.)
  if (!IS_PACKAGED && isScoutSourceRoot(SOURCE_REPO_ROOT)) {
    const backend: SourceBackend | null = createSourcePythonBackend(
      SOURCE_REPO_ROOT,
      await findPythonForRoot(SOURCE_REPO_ROOT),
      backendArgs
    )

    if (backend) {
      return backend
    }
  }

  // 3. SCOUT_DESKTOP_SCOUT — an explicit deployment override (used by the
  //    Nix wrapper), not a discovered PATH candidate. The pinned backend is
  //    the only valid runtime there. Resolve it before any mutable install,
  //    which may belong to an older release or a different Python environment.
  const scoutOverride: string | undefined = process.env.SCOUT_DESKTOP_SCOUT
  let scoutCommand: string | null = null

  if (scoutOverride) {
    const resolvedOverride: string | null = findOnPath(scoutOverride)

    if (resolvedOverride) {
      scoutCommand = resolvedOverride
    } else if (!isWindowsBinaryPathInWsl(scoutOverride, { isWsl: IS_WSL })) {
      scoutCommand = scoutOverride
    } else {
      rememberLog(`Ignoring Windows Scout override under WSL: ${scoutOverride}`)
    }

    if (scoutCommand) {
      if (looksLikeDesktopAppBinary(scoutCommand)) {
        rememberLog(`Ignoring desktop app executable on PATH while resolving Scout CLI: ${scoutCommand}`)
        scoutCommand = null
      } else {
        const unwrapped: Awaited<ReturnType<typeof unwrapWindowsVenvScoutCommand>> =
          await unwrapWindowsVenvScoutCommand(scoutCommand, backendArgs)

        if (unwrapped) {
          return unwrapped
        }

        const shellForProbe: boolean = isCommandScript(scoutCommand)

        if (shouldTrustScoutOverride(scoutOverride) || (await verifyScoutCli(scoutCommand, { shell: shellForProbe }))) {
          return {
            label: `existing Scout CLI at ${scoutCommand}`,
            command: scoutCommand,
            args: backendArgs,
            bootstrap: false,
            env: {},
            kind: 'command',
            shell: shellForProbe,
            local: 'installed'
          }
        }

        rememberLog(
          `Ignoring existing Scout CLI at ${scoutCommand}: --version probe failed; falling through to bootstrap.`
        )
      }
    }
  }

  // 4. ACTIVE_SCOUT_ROOT — the canonical install at
  //    %LOCALAPPDATA%\\scout\\scout-agent (Windows) or ~/.scout/scout-agent.
  //    A valid bootstrap marker proves Desktop finished the first-run install
  //    flow, but marker provenance is NOT the same thing as runtime usability:
  //    the CLI can publish the same installation launcher, and older desktop
  //    builds could leave a healthy install behind without the marker. If the
  //    active runtime is usable, launch it directly; only fall through to
  //    bootstrap when the runtime itself is unusable.
  //    SCOUT_DESKTOP_IGNORE_EXISTING=1 skips this rung (see backend-resolution).
  const activeBackend: SourceBackend | null = await installedRuntimeGate.resolve(ACTIVE_SCOUT_ROOT, () =>
    resolveSourceInstallationBackend(ACTIVE_SCOUT_ROOT, backendArgs, { scoutHome: SCOUT_HOME })
  )

  const activeRuntime: ActiveRuntimeState = activeRuntimeState(activeBackend)

  if (activeBackend && !bootstrapRepairRequested) {
    if (!activeRuntime.hasValidMarker) {
      rememberLog(
        `[bootstrap] Active Scout runtime at ${ACTIVE_SCOUT_ROOT} is usable but the bootstrap marker is missing or stale; skipping first-run bootstrap.`
      )
    }

    return activeBackend
  }

  if (bootstrapRepairRequested) {
    rememberLog('[bootstrap] repair requested; bypassing the usable active runtime to re-run the installer')
  }

  // 5. Nothing usable yet -- signal the bootstrap runner that we need to
  //    clone+install. Phase 1D's bootstrap-runner consumes this sentinel
  //    and drives install.ps1 stages with a progress UI. Until 1D lands,
  //    callers see the sentinel and surface it as a user-facing error
  //    explaining what's missing.
  //
  //    We deliberately do NOT throw here -- throwing inside
  //    resolveScoutBackend was the old "no payload" path and forced the
  //    user into a dead end. With the bootstrap protocol, "no install yet"
  //    is a recoverable state the GUI can drive through.
  return {
    kind: 'bootstrap-needed',
    label: 'Scout Agent not installed yet; bootstrap required',
    command: null,
    args: backendArgs,
    bootstrap: true,
    env: {},
    shell: false,
    // Hints for the bootstrap runner / UI layer:
    activeRoot: ACTIVE_SCOUT_ROOT,
    installStamp: INSTALL_STAMP, // may be null in dev
    isPackaged: IS_PACKAGED,
    platform: process.platform,
    local: 'none'
  }
}

interface ResolvedScoutBackend {
  kind: string
  label: string
  command: string | null
  args: string[]
  env: NodeJS.ProcessEnv
  bootstrap: boolean
  shell: boolean
  local?: string
  root?: string
  installStamp?: Readonly<InstallStamp> | null
  activeRoot?: string
  isPackaged?: boolean
  platform?: NodeJS.Platform
  readyFile?: boolean
}

// Assemble a single-file multipart/form-data body (FastAPI `UploadFile`
// endpoints, e.g. kanban attachments). Hand-rolled because node's http has no
// FormData and the payload is one file — a dependency would be overkill.
function multipartBody(upload) {
  const boundary = `----scout-${crypto.randomBytes(12).toString('hex')}`
  const filename = String(upload.filename || 'file').replace(/["\r\n]/g, '_')

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${upload.contentType || 'application/octet-stream'}\r\n\r\n`
    ),
    Buffer.from(upload.bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ])

  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

function fetchJson(url, token, options: any = {}) {
  // Retry policy lives in api-transport.ts: idempotent verbs retry on any
  // transient transport error; POST/PUT/DELETE only when the request provably
  // never reached the server (see shouldRetryRequest) — never double-submit.
  return withRetry(
    (requestState: any) =>
      new Promise((resolve, reject) => {
        const { body, contentType } = options.upload
          ? multipartBody(options.upload)
          : {
              body: options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body)),
              contentType: 'application/json'
            }

        const parsed = new URL(url)
        const client = parsed.protocol === 'https:' ? https : http
        const agent = jsonAgentFor(parsed.protocol)
        const timeoutMs = resolveTimeoutMs(options.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS)

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          reject(new Error(`Unsupported Scout backend URL protocol: ${parsed.protocol}`))

          return
        }

        const req = client.request(
          parsed,
          {
            agent,
            method: options.method || 'GET',
            headers: {
              ...headersForRemoteRequest(url),
              ...(options.headers || {}),
              'Content-Type': contentType,
              'X-Scout-Session-Token': token,
              // RFC 8252 native flow authenticates the gated gateway with a bearer
              // token instead of the loopback session-token header. When
              // ``options.bearer`` is set we send Authorization: Bearer <token>;
              // the gateway's OAuth gate verifies it via the provider stack with
              // no cookie involved.
              ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
              ...(body ? { 'Content-Length': String(body.length) } : {})
            }
          },
          res => {
            const chunks = []
            res.on('error', reject)
            res.on('data', chunk => chunks.push(chunk))
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8')

              if ((res.statusCode || 500) >= 400) {
                reject(httpStatusError(res.statusCode, text, res.statusMessage))

                return
              }

              // http.request never follows redirects, so any 3xx -- with an HTML
              // login page, an empty body, whatever -- is the request bouncing
              // off a proxy or a scheme/slash mismatch, never JSON.
              if (res.statusCode >= 300) {
                reject(htmlResponseError(url, res.statusCode, res.headers.location))

                return
              }

              if (!text) {
                resolve(null)

                return
              }

              // A 2xx response whose body is HTML means the request fell through
              // to the SPA index.html (e.g. an unregistered /api path). JSON.parse
              // would throw an opaque `Unexpected token '<'` here, so surface a
              // clear diagnostic with the offending URL instead.
              const looksHtml = /^\s*<(?:!doctype|html)/i.test(text)
              const contentType = String(res.headers['content-type'] || '')

              if (looksHtml || contentType.includes('text/html')) {
                reject(htmlResponseError(url, res.statusCode))

                return
              }

              try {
                resolve(JSON.parse(text))
              } catch {
                reject(new Error(`Invalid JSON from ${url} (status ${res.statusCode}): ${text.slice(0, 200)}`))
              }
            })
          }
        )

        req.on('error', reject)
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Timed out connecting to Scout backend after ${timeoutMs}ms`))
        })

        // From here the request goes on the wire: a later transport error can no
        // longer prove the server didn't process it, so non-idempotent verbs must
        // not be retried past this point.
        requestState.bodySent = true

        if (body) {
          req.write(body)
        }

        req.end()
      }),
    { method: options.method || 'GET' }
  )
}

function fetchPublicJson(url, options: any = {}) {
  // Credential-free JSON GET/POST for public gateway endpoints
  // (``/api/status``, ``/api/auth/providers``). Unlike ``fetchJson`` it sends
  // NO ``X-Scout-Session-Token`` header — used by the auth-mode probe before
  // any credentials exist, and any time we must not leak a token to an
  // endpoint that doesn't need one.
  return withRetry(
    (requestState: any) =>
      new Promise((resolve, reject) => {
        const body = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body))
        let parsed

        try {
          parsed = new URL(url)
        } catch (error) {
          reject(new Error(`Invalid URL: ${error.message}`))

          return
        }

        const client = parsed.protocol === 'https:' ? https : http
        const agent = jsonAgentFor(parsed.protocol)
        const timeoutMs = resolveTimeoutMs(options.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS)

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          reject(new Error(`Unsupported Scout backend URL protocol: ${parsed.protocol}`))

          return
        }

        const req = client.request(
          parsed,
          {
            agent,
            method: options.method || 'GET',
            headers: {
              ...headersForRemoteRequest(url),
              ...(options.headers || {}),
              'Content-Type': 'application/json',
              ...(body ? { 'Content-Length': String(body.length) } : {})
            }
          },
          res => {
            const chunks = []
            res.on('data', chunk => chunks.push(chunk))
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8')

              if ((res.statusCode || 500) >= 400) {
                reject(httpStatusError(res.statusCode, text, res.statusMessage))

                return
              }

              if (res.statusCode >= 300) {
                reject(htmlResponseError(url, res.statusCode, res.headers.location))

                return
              }

              if (!text) {
                resolve(null)

                return
              }

              const looksHtml = /^\s*<(?:!doctype|html)/i.test(text)
              const contentType = String(res.headers['content-type'] || '')

              if (looksHtml || contentType.includes('text/html')) {
                reject(htmlResponseError(url, res.statusCode))

                return
              }

              try {
                resolve(JSON.parse(text))
              } catch {
                reject(new Error(`Invalid JSON from ${url} (status ${res.statusCode}): ${text.slice(0, 200)}`))
              }
            })
          }
        )

        req.on('error', reject)
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Timed out connecting to Scout backend after ${timeoutMs}ms`))
        })

        // Past this point the request is on the wire — see fetchJson.
        requestState.bodySent = true

        if (body) {
          req.write(body)
        }

        req.end()
      }),
    { method: options.method || 'GET' }
  )
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase()

  return MEDIA_MIME_TYPES[ext] || 'application/octet-stream'
}

function extensionForMimeType(mimeType) {
  const type = String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()

  if (type === 'image/png') {
    return '.png'
  }

  if (type === 'image/jpeg') {
    return '.jpg'
  }

  if (type === 'image/gif') {
    return '.gif'
  }

  if (type === 'image/webp') {
    return '.webp'
  }

  if (type === 'image/bmp') {
    return '.bmp'
  }

  if (type === 'image/svg+xml') {
    return '.svg'
  }

  return ''
}

function filenameFromUrl(rawUrl, fallback = 'image') {
  try {
    const parsed = new URL(rawUrl)
    const base = path.basename(decodeURIComponent(parsed.pathname || ''))

    return base && base.includes('.') ? base : fallback
  } catch {
    return fallback
  }
}

// Link title resolution — curl (tier 1) → hidden BrowserWindow (tier 2).
const titleCache = new Map()
const titleInflight = new Map()
const TITLE_CACHE_LIMIT = 500
const TITLE_BYTE_BUDGET = 96 * 1024
const TITLE_TIMEOUT_MS = 5000
const TITLE_MAX_REDIRECTS = 3

// Browser-shaped UA — many bot-walled sites (GetYourGuide, Cloudflare-protected
// pages) refuse anything that doesn't look like a real Chrome.
const TITLE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

// Tier-2 renderer fallback config. Only invoked when curl came back with no
// usable title and no sign-in wall (electron/link-title-wall.ts) — keeps
// cold/CDN-cached pages on the cheap path.
const RENDER_TITLE_MAX_CONCURRENT = 2
const RENDER_TITLE_TIMEOUT_MS = 8000
const RENDER_TITLE_GRACE_MS = 700

// Resource types we cancel before the network even fires — keeps the hidden
// renderer fast and cuts third-party tracking noise.
const RENDER_TITLE_BLOCKED_RESOURCES = new Set([
  'cspReport',
  'font',
  'imageset',
  'media',
  'object',
  'ping',
  'stylesheet'
])

let linkTitleSession = null
let oauthSession = null
let renderTitleInFlight = 0
const renderTitleQueue = []

function cacheTitle(key, title) {
  if (titleCache.size >= TITLE_CACHE_LIMIT) {
    titleCache.delete(titleCache.keys().next().value)
  }

  titleCache.set(key, title)
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/gi, (_, k) => HTML_ENTITIES[k.toLowerCase()] ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16) || 32))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10) || 32))
}

function parseHtmlTitle(html) {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]

  return raw ? decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim() : ''
}

const URL_EFFECTIVE_TAIL_BYTES = 4096

function fetchHtmlTitleWithCurl(rawUrl: string): Promise<{ authWall: boolean; title: string }> {
  return new Promise(resolve => {
    const url = String(rawUrl || '').trim()

    if (!url) {
      return resolve({ authWall: false, title: '' })
    }

    const args = [
      '--silent',
      '--show-error',
      '--location',
      '--max-redirs',
      String(TITLE_MAX_REDIRECTS),
      '--max-time',
      String(Math.max(2, Math.ceil(TITLE_TIMEOUT_MS / 1000))),
      '--connect-timeout',
      '4',
      '--user-agent',
      TITLE_USER_AGENT,
      '--header',
      'Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      '--header',
      'Accept-Language: en-US,en;q=0.7',
      '--header',
      'Accept-Encoding: identity',
      '--raw',
      // Arrival URL after redirects, on its own line after the body: a sign-in
      // wall is proven from where curl landed even when the page has no markup id.
      '--write-out',
      CURL_TITLE_WRITE_OUT,
      url
    ]

    const child = spawn('curl', args, hiddenWindowsChildOptions({ stdio: ['ignore', 'pipe', 'ignore'] }))
    const chunks: Buffer[] = []
    // The last bytes of stdout, kept past the body budget so the `--write-out`
    // arrival URL survives a body larger than TITLE_BYTE_BUDGET.
    let tail = Buffer.alloc(0)
    let bytes = 0

    child.stdout.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      tail = Buffer.concat([tail, buffer]).subarray(-URL_EFFECTIVE_TAIL_BYTES)

      if (bytes >= TITLE_BYTE_BUDGET) {
        return
      }

      const remaining = TITLE_BYTE_BUDGET - bytes
      const next = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer
      chunks.push(next)
      bytes += next.length
    })

    child.on('error', () => resolve({ authWall: false, title: '' }))
    child.on('close', () => {
      if (!chunks.length) {
        return resolve({ authWall: false, title: '' })
      }

      // The trailer is inside `bodyWithTrailer` unless the budget cut it off;
      // then it is still present in the separately retained tail.
      const bodyWithTrailer = Buffer.concat(chunks)
      const { effectiveUrl, html } = parseCurlTitleResponse(bodyWithTrailer, tail)

      const title = parseHtmlTitle(html)

      // A sign-in wall answers the cookieless title partition, and tier 2 must
      // never load it: the wall asks the OS for a passkey.
      resolve({ authWall: isAuthWall({ body: html, effectiveUrl, title }), title })
    })
  })
}

function getLinkTitleSession() {
  if (linkTitleSession || !app.isReady()) {
    return linkTitleSession
  }

  linkTitleSession = session.fromPartition('scout:link-titles', { cache: false })
  linkTitleSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: RENDER_TITLE_BLOCKED_RESOURCES.has(details.resourceType) })
  })
  guardLinkTitleSession(linkTitleSession)

  return linkTitleSession
}

function dequeueRenderTitle() {
  while (renderTitleInFlight < RENDER_TITLE_MAX_CONCURRENT && renderTitleQueue.length) {
    const item = renderTitleQueue.shift()
    renderTitleInFlight += 1
    runRenderTitleJob(item.url).then(title => {
      renderTitleInFlight -= 1
      item.resolve(title)
      dequeueRenderTitle()
    })
  }
}

function runRenderTitleJob(rawUrl) {
  return new Promise(resolve => {
    if (!app.isReady()) {
      return resolve('')
    }

    const partitionSession = getLinkTitleSession()

    if (!partitionSession) {
      return resolve('')
    }

    let settled = false
    let window = null
    let hardTimer = null
    let graceTimer = null

    const finish = title => {
      if (settled) {
        return
      }

      settled = true

      if (hardTimer) {
        clearTimeout(hardTimer)
      }

      if (graceTimer) {
        clearTimeout(graceTimer)
      }

      const value = (title || '').replace(/\s+/g, ' ').trim()

      try {
        if (window && !window.isDestroyed()) {
          window.destroy()
        }
      } catch {
        // BrowserWindow may already be torn down; ignore.
      }

      resolve(value)
    }

    try {
      window = createLinkTitleWindow(BrowserWindow, partitionSession)
    } catch {
      return finish('')
    }

    const finishWithTitle = () => finish(readLinkTitleWindowTitle(window))

    const scheduleGrace = () => {
      if (graceTimer) {
        clearTimeout(graceTimer)
      }

      graceTimer = setTimeout(finishWithTitle, RENDER_TITLE_GRACE_MS)
    }

    hardTimer = setTimeout(finishWithTitle, RENDER_TITLE_TIMEOUT_MS)

    window.webContents.setUserAgent(TITLE_USER_AGENT)
    window.webContents.on('page-title-updated', scheduleGrace)
    window.webContents.on('did-finish-load', scheduleGrace)
    window.webContents.on('did-fail-load', (_event, _code, _desc, _validatedURL, isMainFrame) => {
      if (isMainFrame) {
        finish('')
      }
    })

    window
      .loadURL(rawUrl, {
        httpReferrer: 'https://www.google.com/',
        userAgent: TITLE_USER_AGENT
      })
      .catch(() => finish(''))
  })
}

function fetchHtmlTitleWithRenderer(rawUrl: string): Promise<string> {
  return new Promise(resolve => {
    renderTitleQueue.push({ resolve, url: rawUrl })
    dequeueRenderTitle()
  })
}

// Tier ladder (curl → hidden renderer) and its sign-in-wall rule live in
// electron/link-title-wall.ts; main.ts only supplies the two tiers' I/O.
function fetchLinkTitle(rawUrl) {
  const url = String(rawUrl || '').trim()

  // Scheme gate (#93893): only absolute http(s) URLs enter the title
  // pipeline. Anything else — leaked `@url:` markup, placeholders, garbage —
  // must never reach curl or the hidden title window's loadURL(), where it
  // surfaces as a repeating `Failed to load URL: … ERR_NAME_NOT_RESOLVED`
  // loop. canonicalTitleCacheKey's '' return is the second layer of the same
  // guard; this check keeps non-URLs out even when a parseable-but-wrong
  // scheme (file:, mailto:) would still build a cache key.
  if (!isFetchableHttpUrl(url)) {
    return Promise.resolve('')
  }

  const key = canonicalTitleCacheKey(url)

  if (!key) {
    return Promise.resolve('')
  }

  if (titleCache.has(key)) {
    return Promise.resolve(titleCache.get(key))
  }

  if (titleInflight.has(key)) {
    return Promise.resolve(titleInflight.get(key))
  }

  const pending = resolveLinkTitle({
    curl: () => fetchHtmlTitleWithCurl(url),
    renderer: () => fetchHtmlTitleWithRenderer(url),
    url
  }).then(clean => {
    cacheTitle(key, clean)
    titleInflight.delete(key)

    return clean
  })

  titleInflight.set(key, pending)

  return pending
}

// ─── Favicon resolution ──────────────────────────────────────────────────────
// The ladder itself is electron/favicon.ts; this is its I/O, its cache, and
// the one rule that belongs to the app rather than the algorithm: one icon
// per host. A connector's mark doesn't vary by path, and hosting the cache on
// the host key means Linear's docs page and Linear's MCP endpoint cost one
// lookup between them.

const FAVICON_CACHE_PATH = path.join(app.getPath('userData'), 'favicon-cache.json')
const FAVICON_CACHE_LIMIT = 400
const FAVICON_TTL_MS = 30 * 24 * 60 * 60 * 1000
// A miss is cheap to re-check and expensive to be wrong about (a site that
// was behind a captcha yesterday has a logo today), so it expires fast.
const FAVICON_MISS_TTL_MS = 12 * 60 * 60 * 1000
const FAVICON_TIMEOUT_MS = 6000
const FAVICON_MAX_BYTES = 256 * 1024
const FAVICON_WRITE_DEBOUNCE_MS = 3000

let faviconCache: Map<string, { at: number; icon: string }> | null = null
let faviconWriteTimer: null | ReturnType<typeof setTimeout> = null
const faviconInflight = new Map<string, Promise<string>>()

function faviconCacheKey(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function loadFaviconCache(): Map<string, { at: number; icon: string }> {
  if (faviconCache) {
    return faviconCache
  }

  faviconCache = new Map()

  try {
    const raw = JSON.parse(fs.readFileSync(FAVICON_CACHE_PATH, 'utf8'))

    for (const [host, entry] of Object.entries(raw?.icons ?? {})) {
      const at = Number((entry as { at?: number })?.at)
      const icon = String((entry as { icon?: string })?.icon ?? '')

      if (Number.isFinite(at) && Date.now() - at < (icon ? FAVICON_TTL_MS : FAVICON_MISS_TTL_MS)) {
        faviconCache.set(host, { at, icon })
      }
    }
  } catch {
    // No cache yet, or it's unreadable — resolving again is the whole cost.
  }

  return faviconCache
}

function saveFaviconCacheSoon() {
  if (faviconWriteTimer) {
    return
  }

  faviconWriteTimer = setTimeout(() => {
    faviconWriteTimer = null

    try {
      const icons = Object.fromEntries(loadFaviconCache())

      fs.writeFileSync(FAVICON_CACHE_PATH, JSON.stringify({ icons }), 'utf8')
    } catch {
      // Cache is an optimization; failing to persist it costs one refetch.
    }
  }, FAVICON_WRITE_DEBOUNCE_MS)

  faviconWriteTimer.unref?.()
}

async function faviconFetch(url: string, accept: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FAVICON_TIMEOUT_MS)

  try {
    return await electronNet.fetch(url, {
      // Same browser-shaped identity the title fetcher uses: a plain Electron
      // UA gets a challenge page from anything behind a bot wall.
      headers: { Accept: accept, 'Accept-Language': 'en-US,en;q=0.7', 'User-Agent': TITLE_USER_AGENT },
      redirect: 'follow',
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

const faviconIo: FaviconIo = {
  fetchImage: async url => {
    const response = await faviconFetch(url, 'image/avif,image/webp,image/svg+xml,image/*;q=0.8,*/*;q=0.5')

    if (!response.ok) {
      return null
    }

    const buffer = await response.arrayBuffer()

    if (buffer.byteLength === 0 || buffer.byteLength > FAVICON_MAX_BYTES) {
      return null
    }

    return { bytes: new Uint8Array(buffer), mime: response.headers.get('content-type') ?? '' }
  },
  fetchText: async url => {
    const response = await faviconFetch(url, 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5')

    if (!response.ok) {
      return ''
    }

    const bytes = new Uint8Array(await response.arrayBuffer()).subarray(0, TITLE_BYTE_BUDGET * 2)

    return decodeWebText(bytes, response.headers.get('content-type') ?? '')
  }
}

function resolveFaviconCached(rawUrl: string): Promise<string> {
  const key = faviconCacheKey(String(rawUrl || '').trim())

  if (!key) {
    return Promise.resolve('')
  }

  const cache = loadFaviconCache()
  const hit = cache.get(key)

  if (hit && Date.now() - hit.at < (hit.icon ? FAVICON_TTL_MS : FAVICON_MISS_TTL_MS)) {
    return Promise.resolve(hit.icon)
  }

  const inflight = faviconInflight.get(key)

  if (inflight) {
    return inflight
  }

  const pending = resolveFavicon(rawUrl, faviconIo)
    .catch(() => '')
    .then(icon => {
      if (cache.size >= FAVICON_CACHE_LIMIT) {
        cache.delete(cache.keys().next().value)
      }

      cache.set(key, { at: Date.now(), icon })
      saveFaviconCacheSoon()
      faviconInflight.delete(key)

      return icon
    })

  faviconInflight.set(key, pending)

  return pending
}

async function resourceBufferFromUrl(rawUrl) {
  if (!rawUrl) {
    throw new Error('Missing URL')
  }

  if (rawUrl.startsWith('data:')) {
    const match = rawUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)

    if (!match) {
      throw new Error('Invalid data URL')
    }

    const mimeType = match[1] || 'application/octet-stream'
    const encoded = match[3] || ''
    const buffer = match[2] ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded), 'utf8')

    return { buffer, mimeType }
  }

  if (/^file:/i.test(rawUrl)) {
    const { resolvedPath } = await resolveReadableFileForIpc(rawUrl, { purpose: 'Image file' })
    const buffer = await fs.promises.readFile(resolvedPath)

    return { buffer, mimeType: mimeTypeForPath(resolvedPath) }
  }

  const parsed = new URL(rawUrl)
  const client = parsed.protocol === 'https:' ? https : http

  return new Promise((resolve, reject) => {
    const req = client.get(parsed, res => {
      if ((res.statusCode || 500) >= 400) {
        reject(new Error(`Failed to fetch ${rawUrl}: ${res.statusCode}`))
        res.resume()

        return
      }

      const chunks = []
      res.on('error', reject)
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          buffer: Buffer.concat(chunks),
          mimeType: res.headers['content-type'] || 'application/octet-stream'
        })
      })
    })

    req.on('error', reject)
  })
}

async function saveImageFromUrl(rawUrl) {
  const { buffer, mimeType } = (await resourceBufferFromUrl(rawUrl)) as any
  const extension = extensionForMimeType(mimeType) || '.png'
  // Generated-image URLs (fal.media etc.) usually end in an extensionless
  // content hash. Keep the name but always guarantee an extension — without
  // one Windows saves an unopenable "All Files" blob (#image18 report).
  const baseName = filenameFromUrl(rawUrl, `image${extension}`)
  const fallbackName = path.extname(baseName) ? baseName : `${baseName}${extension}`

  let downloadsDir = ''

  try {
    downloadsDir = app.getPath('downloads')
  } catch {
    // Leave the dialog at its last-used location when the OS has no
    // Downloads directory to offer.
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Image',
    defaultPath: downloadsDir ? path.join(downloadsDir, fallbackName) : fallbackName,
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  if (result.canceled || !result.filePath) {
    return false
  }

  await fs.promises.writeFile(result.filePath, buffer)

  return true
}

async function writeComposerImage(buffer, ext = '.png', name = '') {
  const rawExt = String(ext || '.png')
    .trim()
    .toLowerCase()

  const normalizedExt = rawExt.startsWith('.') ? rawExt : `.${rawExt}`
  const safeExt = /^\.[a-z0-9]{1,5}$/.test(normalizedExt) ? normalizedExt : '.png'
  const dir = path.join(app.getPath('userData'), 'composer-images')
  await fs.promises.mkdir(dir, { recursive: true })
  const stamp = composerImageTimestamp()
  const random = crypto.randomBytes(3).toString('hex')

  const baseName = String(name || '')
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, '')

  const safeName = (baseName || '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80)

  const fileName = safeName ? `${safeName}_${random}${safeExt}` : `composer_${stamp}_${random}${safeExt}`
  const filePath = path.join(dir, fileName)
  await fs.promises.writeFile(filePath, buffer)

  return filePath
}

function previewLabelForUrl(url) {
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
}

function expandUserPath(filePath) {
  const value = String(filePath || '').trim()

  if (value === '~') {
    return app.getPath('home')
  }

  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    return path.join(app.getPath('home'), value.slice(2))
  }

  return value
}

async function previewFileTarget(rawTarget, baseDir) {
  const raw = String(rawTarget || '').trim()
  const base = baseDir ? path.resolve(expandUserPath(baseDir)) : resolveScoutCwd()

  // A plain backend target is a WSL/POSIX path; bridge it to a Windows-
  // accessible form before resolving so the existence checks below (and the
  // final read) hit the real file rather than a drive-relative C:\home\... miss.
  let resolved = resolveRequestedPathForIpc(resolvePreviewTargetPath(raw, expandUserPath), {
    baseDir: base,
    purpose: 'Preview target'
  })

  // Attachment references stored in chat history are frequently HOME-relative
  // (e.g. "AppData/Local/scout/attachments/foo.xlsx" on Windows, or
  // ".scout/attachments/foo.xlsx" elsewhere) rather than relative to the
  // agent's working directory. The primary resolution above only tries
  // `base` (the working dir), so such a ref never exists there and the
  // preview/download 404s even though the file is present on disk (#115609).
  if (!fileExists(resolved) && !directoryExists(resolved)) {
    for (const candidate of homeRelativeAttachmentCandidates(raw, app.getPath('home'), SCOUT_HOME)) {
      if (fileExists(candidate)) {
        resolved = candidate

        break
      }
    }
  }

  if (directoryExists(resolved)) {
    resolved = path.join(resolved, 'index.html')
  }

  const ext = path.extname(resolved).toLowerCase()

  if (!fileExists(resolved)) {
    return null
  }

  ;({ resolvedPath: resolved } = await resolveReadableFileForIpc(resolved, { purpose: 'Preview target' }))

  const mimeType = mimeTypeForPath(resolved)
  const metadata = previewFileMetadata(resolved, mimeType)
  const isHtml = PREVIEW_HTML_EXTENSIONS.has(ext)
  const isImage = mimeType.startsWith('image/')
  const isPdf = PREVIEW_PDF_EXTENSIONS.has(ext) || mimeType === 'application/pdf'
  const previewKind = isHtml ? 'html' : isImage ? 'image' : isPdf ? 'pdf' : metadata.binary ? 'binary' : 'text'

  return {
    binary: metadata.binary,
    byteSize: metadata.byteSize,
    kind: 'file',
    large: metadata.large,
    label: path.basename(resolved),
    language: PREVIEW_LANGUAGE_BY_EXT[ext] || 'text',
    mimeType,
    path: resolved,
    previewKind,
    source: raw,
    url: pathToFileURL(resolved).toString()
  }
}

function previewUrlTarget(rawTarget) {
  const raw = String(rawTarget || '').trim()
  const url = new URL(raw)

  if (!['http:', 'https:'].includes(url.protocol)) {
    return null
  }

  if (!LOCAL_PREVIEW_HOSTS.has(url.hostname.toLowerCase())) {
    return null
  }

  if (url.hostname === '0.0.0.0') {
    url.hostname = '127.0.0.1'
  }

  return {
    kind: 'url',
    label: previewLabelForUrl(url),
    source: raw,
    url: url.toString()
  }
}

async function normalizePreviewTarget(rawTarget, baseDir) {
  const raw = String(rawTarget || '').trim()

  if (!raw) {
    return null
  }

  try {
    if (/^https?:\/\//i.test(raw)) {
      return previewUrlTarget(raw)
    }

    return await previewFileTarget(raw, baseDir)
  } catch {
    return null
  }
}

async function filePathFromPreviewUrl(rawUrl) {
  const { resolvedPath } = await resolveReadableFileForIpc(String(rawUrl || ''), { purpose: 'Preview file' })

  return resolvedPath
}

async function watchPreviewFile(owner, rawUrl) {
  const filePath = await filePathFromPreviewUrl(rawUrl)
  const watchDir = path.dirname(filePath)
  const targetName = path.basename(filePath)
  const id = crypto.randomBytes(12).toString('base64url')
  let timer = null

  // Proactive teardown: the watch must not outlive the window that asked for
  // it by whole quit-cycles waiting on a change event that never comes.
  const offOwnerDestroyed = onPreviewWatchOwnerDestroyed(owner, () => stopPreviewFileWatch(id))

  const watcher = fs.watch(watchDir, (_eventType, filename) => {
    const changedName = filename ? path.basename(String(filename)) : ''

    if (changedName && changedName !== targetName) {
      return
    }

    if (timer) {
      clearTimeout(timer)
    }

    timer = setTimeout(() => {
      timer = null

      if (!fileExists(filePath)) {
        return
      }

      sendPreviewFileChangedToOwner(owner, { id, path: filePath, url: pathToFileURL(filePath).toString() }, () =>
        stopPreviewFileWatch(id)
      )
    }, PREVIEW_WATCH_DEBOUNCE_MS)
  })

  previewWatchers.set(id, {
    owner,
    close: () => {
      offOwnerDestroyed()

      if (timer) {
        clearTimeout(timer)
      }

      watcher.close()
    }
  })

  return { id, path: filePath }
}

function stopPreviewFileWatch(id) {
  const watcher = previewWatchers.get(id)

  if (!watcher) {
    return false
  }

  watcher.close()
  previewWatchers.delete(id)

  return true
}

function closePreviewWatchers() {
  for (const id of previewWatchers.keys()) {
    stopPreviewFileWatch(id)
  }
}

function requestOptionsWithHeaders(options: any = {}, headers = {}) {
  return {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {})
    }
  }
}

/** Watch a DIRECTORY for entry churn (folders appearing/vanishing) — the
 *  disk-plugin door's "new plugin folder" signal, replacing the renderer's 5s
 *  readdir poll. Same registry + change channel as the preview file watchers
 *  (the renderer reconciles on any tick; per-file edits stay on their own
 *  watches), so stopPreviewFileWatch/closePreviewWatchers manage these too. */
function watchDirectory(owner, rawDir) {
  const watchDir = path.resolve(String(rawDir || ''))

  if (!fs.existsSync(watchDir) || !fs.statSync(watchDir).isDirectory()) {
    throw new Error(`Not a directory: ${watchDir}`)
  }

  const id = crypto.randomBytes(12).toString('base64url')
  let timer = null

  // Same proactive teardown as a file watch: a closed window's directory
  // watch must not keep polling the disk-plugin door until quit.
  const offOwnerDestroyed = onPreviewWatchOwnerDestroyed(owner, () => stopPreviewFileWatch(id))

  const watcher = fs.watch(watchDir, () => {
    if (timer) {
      clearTimeout(timer)
    }

    timer = setTimeout(() => {
      timer = null
      sendPreviewFileChangedToOwner(owner, { id, path: watchDir, url: pathToFileURL(watchDir).toString() }, () =>
        stopPreviewFileWatch(id)
      )
    }, PREVIEW_WATCH_DEBOUNCE_MS)
  })

  previewWatchers.set(id, {
    owner,
    close: () => {
      offOwnerDestroyed()

      if (timer) {
        clearTimeout(timer)
      }

      watcher.close()
    }
  })

  return { id, path: watchDir }
}

// Build the readiness probe for a connection's auth mode. A gated gateway
// must be probed with the SAME credentials the rest of the connection uses:
// an anonymous probe 401s forever against a live session, and it can never
// see the 404 that identifies a backend predating /api/health (the auth gate
// answers before the SPA catch-all). `probeIsCredentialed` tells
// waitForScoutReady how to read a 401 — rejected session vs gated route.
async function buildReadinessHealthProbe(baseUrl, authMode, token) {
  if (authMode === 'oauth') {
    return {
      // fetchJson takes the bearer via `options.bearer` — a raw `headers`
      // option is ignored, so passing one here would silently probe
      // uncredentialed and reintroduce the 401 loop.
      probeHealth: (url: string, options: any = {}) =>
        requestWithOauthFallback(baseUrl, {
          ensureNativeAccessToken,
          requestWithBearer: (bearer: string) => fetchJson(url, null, { ...options, bearer }),
          requestWithCookie: () => fetchJsonViaOauthSession(url, options)
        }),
      probeIsCredentialed: true
    }
  }

  const probeAuth = resolveReadinessProbeAuth(authMode, null, token)

  if (probeAuth.kind === 'token' && probeAuth.token) {
    return {
      probeHealth: (url, options: any = {}) => fetchJson(url, probeAuth.token, options),
      probeIsCredentialed: true
    }
  }

  return { probeHealth: fetchPublicJson, probeIsCredentialed: false }
}

// Boot-time readiness for a remote connection object.
async function waitForRemoteScout(remote) {
  await waitForScout(remote.baseUrl, remote.token, undefined, remote.authMode, remote.headers)
}

async function waitForScout(
  baseUrl: string,
  token: string | null | undefined,
  signal?: AbortSignal,
  authMode?: string | null,
  headers: Record<string, string> = {},
  { alreadyBound = false }: { alreadyBound?: boolean } = {}
): Promise<void> {
  const { probeHealth, probeIsCredentialed } = await buildReadinessHealthProbe(baseUrl, authMode, token)

  return waitForScoutReady(baseUrl, {
    token,
    signal,
    fetchPublicJson,
    fetchJson: probeIsCredentialed
      ? (url, _token, options = {}) => probeHealth(url, requestOptionsWithHeaders(options, headers))
      : fetchJson,
    probeHealth: (url, options = {}) => probeHealth(url, requestOptionsWithHeaders(options, headers)),
    probeIsCredentialed,
    alreadyBound
  })
}

function getWindowButtonPosition(win = mainWindow) {
  if (!IS_MAC) {
    return null
  }

  // Fullscreen hides the traffic lights — treat as no left-side controls so the
  // renderer drops the traffic-light dodge inset and Y nudge.
  if (win?.isFullScreen?.()) {
    return null
  }

  return win?.getWindowButtonPosition?.() || WINDOW_BUTTON_POSITION
}

function getNativeOverlayWidth() {
  return computeNativeOverlayWidth({ isWindows: IS_WINDOWS, isWsl: IS_WSL, isMac: IS_MAC })
}

function getWindowState(win = mainWindow) {
  return {
    isFullscreen: Boolean(win?.isFullScreen?.()),
    isMinimized: Boolean(win?.isMinimized?.()),
    isVisible: Boolean(win?.isVisible?.()),
    nativeOverlayWidth: getNativeOverlayWidth(),
    windowButtonPosition: getWindowButtonPosition(win),
    darwinMajor: IS_MAC ? DARWIN_MAJOR : 0,
    ...windowControlState(win, !IS_WINDOWS && IS_WSL)
  }
}

function sendClosePreviewRequested() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const { webContents } = mainWindow

  if (!webContents || webContents.isDestroyed()) {
    return
  }

  webContents.send('scout:close-preview-requested')
}

/**
 * Run a browser gesture on the guest page the user is actually in, if any.
 *
 * A `<webview>` guest is its own out-of-process webContents: pointer and focus
 * events inside the page never reach the host document, so NOTHING in the
 * renderer — not `document.activeElement`, not the layout tree's hover/focus
 * ladder — can see that the user is in there. Main can: Electron tracks the
 * focused webContents across processes, which is the definition of a runtime
 * fact it owns.
 *
 * Returns false when focus is in the app's own chrome, where the renderer is
 * the one that knows which pane is active.
 */
function commandFocusedGuest(command: 'back' | 'forward' | 'reload'): boolean {
  const focused = electronWebContents.getFocusedWebContents()

  if (!focused || focused.isDestroyed() || focused.getType() !== 'webview') {
    return false
  }

  const history = focused.navigationHistory

  if (command === 'reload') {
    focused.reload()
  } else if (command === 'back') {
    if (!history.canGoBack()) {
      return true
    }

    history.goBack()
  } else {
    if (!history.canGoForward()) {
      return true
    }

    history.goForward()
  }

  return true
}

/**
 * Ask the renderer to run a browser-navigation gesture on its focused preview
 * pane. `reload` also has an app-level fallback (reload the window); `back` and
 * `forward` mean nothing outside the browser, so the renderer just ignores them.
 */
function sendPreviewNavCommand(command: 'back' | 'forward' | 'reload') {
  // The user is inside the page itself — main is the only party that can see
  // that, so act here and never round-trip.
  if (commandFocusedGuest(command)) {
    return
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const { webContents } = mainWindow

  if (!webContents || webContents.isDestroyed()) {
    return
  }

  webContents.send('scout:preview-nav', command)
}

/**
 * The native back/forward gestures, which never reach the renderer on their own.
 *
 * - macOS: a two/three-finger swipe. Chromium's own overscroll navigation is
 *   off in an Electron window, so the OS gesture surfaces as this event and
 *   nothing consumes it. Requires "Swipe between pages" in System Settings.
 * - Windows/Linux: the dedicated back/forward buttons on a mouse, delivered as
 *   `WM_APPCOMMAND`.
 */
function installBrowserNavGestures(window) {
  window.on('swipe', (_event, direction) => {
    if (direction === 'left' || direction === 'right') {
      // Swipe LEFT moves the page left, revealing what's behind it — that's
      // back. Matches Safari, Chrome, and Finder.
      sendPreviewNavCommand(direction === 'left' ? 'back' : 'forward')
    }
  })

  window.on('app-command', (event, command) => {
    if (command !== 'browser-backward' && command !== 'browser-forward') {
      return
    }

    // Claim it either way: unhandled, Chromium walks the HOST document's
    // history, which would navigate the app shell itself.
    event.preventDefault()
    sendPreviewNavCommand(command === 'browser-backward' ? 'back' : 'forward')
  })
}

function sendOpenFolderRequested() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const webContents = mainWindow.webContents

  if (!webContents || webContents.isDestroyed()) {
    return
  }

  webContents.send('scout:open-folder-requested')
}

// Tell the renderer the machine just woke. Sleep silently drops the
// renderer's WebSocket to the local backend; the renderer reconnects on this
// signal so the chat composer doesn't stay stuck on "Starting Scout...".
function sendPowerResume() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const { webContents } = mainWindow

  if (!webContents || webContents.isDestroyed()) {
    return
  }

  webContents.send('scout:power-resume')
}

let powerResumeRegistered = false

// Mirror of powerMonitor's AC/battery state, broadcast to every window so
// renderer backstop polls can slow down on battery (see store/power.ts).
// `null` until the first powerMonitor read after app ready.
let onBatteryPower: boolean | null = null

// Renderer-side battery gating seeds from this and stays current via the
// 'scout:power-battery' push below.
ipcMain.handle('scout:power-battery:get', () => onBatteryPower === true)

function broadcastBatteryState(next: boolean) {
  if (onBatteryPower === next) {
    return
  }

  onBatteryPower = next

  for (const win of BrowserWindow.getAllWindows()) {
    const { webContents } = win

    if (webContents && !webContents.isDestroyed()) {
      webContents.send('scout:power-battery', next)
    }
  }
}

function registerPowerResumeListeners() {
  if (powerResumeRegistered) {
    return
  }

  powerResumeRegistered = true

  try {
    // 'resume' covers sleep/wake; 'unlock-screen' covers lock/unlock without a
    // full suspend. Either can drop an idle socket.
    powerMonitor.on('resume', sendPowerResume)
    powerMonitor.on('unlock-screen', sendPowerResume)
    powerMonitor.on('on-battery', () => broadcastBatteryState(true))
    powerMonitor.on('on-ac', () => broadcastBatteryState(false))
    onBatteryPower = powerMonitor.isOnBatteryPower()
  } catch {
    // powerMonitor is unavailable before app 'ready' on some platforms; the
    // caller registers after 'ready', so this should not normally throw.
  }
}

function getAppIconPath() {
  // Fail-soft: skip candidates that exist but don't decode (truncated PNG in a
  // packaged app.asar previously crashed createWindow mid-session). Missing
  // every candidate is fine — the window then uses the platform default icon.
  try {
    return resolveAppIcon(APP_ICON_PATHS)
  } catch {
    return undefined
  }
}

function sendOpenUpdatesRequested() {
  // The renderer mounts its open-updates listener in the same effect pass that
  // signals deep-link readiness. Before that (e.g. a boot-time dialog answered
  // before the window is up) queue the request; 'scout:deep-link-ready' flushes it.
  if (!_rendererReadyForDeepLink || !mainWindow || mainWindow.isDestroyed()) {
    _pendingOpenUpdates = true

    return
  }

  const { webContents } = mainWindow

  if (!webContents || webContents.isDestroyed()) {
    return
  }

  webContents.send('scout:open-updates')

  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }

  mainWindow.focus()
}

// Push titlebar/fullscreen chrome state to a window's renderer. Defaults to the
// primary, but any full chat window (primary or a secondary "instance" peer)
// passes itself so its own fullscreen toggle drives its own traffic-light inset.
function sendWindowStateChanged(nextIsFullscreen?: boolean, target = mainWindow) {
  if (!target || target.isDestroyed()) {
    return
  }

  const { webContents } = target

  if (!webContents || webContents.isDestroyed()) {
    return
  }

  const state = getWindowState(target)

  if (typeof nextIsFullscreen === 'boolean') {
    state.isFullscreen = nextIsFullscreen
  }

  webContents.send('scout:window-state-changed', state)
}

function buildApplicationMenu() {
  const template: MenuItemConstructorOptions[] = []

  const checkForUpdatesItem = {
    label: 'Check for Updates…',
    click: () => sendOpenUpdatesRequested()
  }

  if (IS_MAC) {
    template.push({
      label: APP_NAME,
      submenu: [
        { label: `About ${APP_NAME}`, click: () => showAboutPanelFresh() },
        checkForUpdatesItem,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  template.push({
    label: 'File',
    submenu: [
      // No accelerator: ⌘⇧N is a rebindable renderer keybind (session.newWindow);
      // a menu accelerator would fight the rebind panel and (on macOS) be
      // swallowed before the renderer sees it. Here purely for discoverability.
      { click: () => createInstanceWindow(), label: 'New Window' },
      // Same no-accelerator rationale: ⌘O is the rebindable renderer keybind
      // (workspace.openFolder). Clicking runs the same open-folder-as-project
      // flow through the renderer.
      { click: () => sendOpenFolderRequested(), label: 'Open Folder…' },
      { type: 'separator' },
      IS_MAC
        ? {
            // NO accelerator: on macOS a registered ⌘W is consumed by the OS
            // menu before the web contents ever sees it (and registerAccelerator
            // false is a no-op on mac — electron#18295). Leaving it off lets the
            // `before-input-event` handler below intercept ⌘W and route it to the
            // renderer's close-active-tab. Clicking the item still closes the tab
            // (or window) via the same request.
            click: () => sendClosePreviewRequested(),
            label: 'Close'
          }
        : { role: 'quit' }
    ]
  })
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      // ⌘⇧V is only wired up by this item existing: an accelerator with no menu
      // entry is never translated into an editor command, so the chord was a
      // no-op in every input in the app. The composer inserts plain text on
      // every paste anyway, so this is the same result as ⌘V there — it's the
      // terminal, preview, and other editable surfaces that need the strip.
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
      ...(IS_MAC
        ? ([
            { type: 'separator' },
            {
              label: 'Substitutions',
              submenu: [{ role: 'showSubstitutions' }, { type: 'separator' }, { role: 'toggleTextReplacement' }]
            }
          ] satisfies MenuItemConstructorOptions[])
        : [])
    ]
  })
  template.push({
    label: 'View',
    submenu: [
      // Not `role: 'reload'`: that hard-reloads the RENDERER (every pane, the
      // whole shell) and a focused in-app browser needs ⌘R to mean "reload
      // this page", the way it does in every other browser. ⇧⌘R
      // (`forceReload`) below stays the unconditional escape hatch.
      //
      // No accelerator: ⌘R is claimed in `installPreviewShortcut`, which works
      // on every platform (this menu exists only on macOS). Declaring it here
      // too would fire the item and the input hook for one keypress.
      { click: () => sendPreviewNavCommand('reload'), label: 'Reload' },
      { role: 'forceReload' },
      {
        label: 'Toggle Developer Tools',
        accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
        click: (_menuItem, browserWindow) => toggleDevTools(browserWindow || mainWindow)
      },
      { type: 'separator' },
      {
        label: 'Actual Size',
        accelerator: 'CommandOrControl+0',
        click: () => {
          setAndPersistZoomLevel(mainWindow, DEFAULT_ZOOM_LEVEL)
        }
      },
      {
        label: 'Zoom In',
        accelerator: 'CommandOrControl+Plus',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            setAndPersistZoomLevel(mainWindow, mainWindow.webContents.getZoomLevel() + ZOOM_STEP)
          }
        }
      },
      {
        label: 'Zoom Out',
        accelerator: 'CommandOrControl+-',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            setAndPersistZoomLevel(mainWindow, mainWindow.webContents.getZoomLevel() - ZOOM_STEP)
          }
        }
      },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  })
  template.push({
    label: 'Window',
    submenu: IS_MAC
      ? [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'close' }]
  })
  template.push({
    label: 'Help',
    role: 'help',
    submenu: [checkForUpdatesItem]
  })

  return Menu.buildFromTemplate(template)
}

function toggleDevTools(window) {
  // DevTools is enabled in packaged builds so users can diagnose renderer
  // issues without needing a dev build. Trade-off: tiny attack surface
  // increase versus a much better support story when WS connection or
  // CSP issues surface in the field.
  const { webContents } = window

  if (webContents.isDevToolsOpened()) {
    webContents.closeDevTools()
  } else {
    webContents.openDevTools({ mode: 'detach' })
  }
}

function installDevToolsShortcut(window) {
  // Only Ctrl+Shift+I (or Cmd+Opt+I on Mac) opens DevTools.
  // F12 is explicitly blocked so Chromium's built-in handler doesn't open it.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return
    }

    const key = input.key.toLowerCase()

    // A renderer binding gets first refusal. Chromium otherwise claims F12
    // before the renderer can capture or dispatch it.
    if (input.key === 'F12') {
      const decision = f12ShortcutDecision(input, f12ShortcutActiveWindows.has(window.webContents.id), f12Blocked)

      if (decision === 'forward') {
        event.preventDefault()

        window.webContents.send('scout:f12-shortcut', toF12KeyboardEventPayload(input))

        return
      }

      if (decision === 'block') {
        event.preventDefault()

        return
      }
      // Not blocked — fall through to open DevTools.
    }

    const isInspectShortcut =
      input.key === 'F12' ||
      (IS_MAC && input.meta && input.alt && key === 'i') ||
      (!IS_MAC && input.control && input.shift && key === 'i')

    if (!isInspectShortcut) {
      return
    }

    event.preventDefault()
    toggleDevTools(window)
  })
}

function installPreviewShortcut(window) {
  let focusedAt = 0

  window.on('focus', () => {
    focusedAt = Date.now()
  })

  window.webContents.on('before-input-event', (event, input) => {
    const action = windowAcceleratorAction(input, IS_MAC, Date.now() - focusedAt)

    // A ⌘W/⌘R that auto-repeats or lands right as focus arrives belongs to
    // the app that just lost focus (#105498). Claim it so the renderer's
    // keybind doesn't act on it either, and do nothing.
    if (action === 'swallow') {
      event.preventDefault()

      return
    }

    // Always claim ⌘W here (the File>Close item deliberately has no
    // accelerator, so nothing else does). The renderer decides tab-vs-window
    // — no `previewShortcutActive` gate, so it works for every closeable tab.
    // keyUp is not a claim: a chord that started in another app can deliver
    // its leftover keyup when this window inherits focus (#105498).
    if (action === 'close-tab') {
      event.preventDefault()

      // ⌘W in the HUD is "leave HUD mode", not "close a tab in the app
      // window". Routing it to the main renderer closed the app's tab out
      // from under the user while the HUD stayed put; routing it through the
      // HUD's own close path hands the session back like the exit button.
      // Keep a closing (or superseded) HUD from sending a second ⌘W to the
      // hidden main window while its 1.5s close grace is still running.
      if (hudWindows.has(window)) {
        if (window === hudWindow && !window.isDestroyed()) {
          closeHudWindow()
        }

        return
      }

      sendClosePreviewRequested()

      return
    }

    // ⌘R rides here rather than on the View menu item for the same reason:
    // the application menu only exists on macOS (it is set to null elsewhere,
    // see #77845), so a menu accelerator would leave Windows and Linux with no
    // way to reload a page at all. ⇧⌘R is left alone — that is `forceReload`,
    // the unconditional whole-window escape hatch.
    if (action === 'reload') {
      event.preventDefault()
      sendPreviewNavCommand('reload')
    }
  })
}

// Zoom level is persisted in the renderer's own localStorage (per-origin,
// survives reloads/restarts) rather than a main-process JSON file. The main
// process owns setZoomLevel, so we mirror each change into localStorage and
// read it back on did-finish-load to re-apply after reloads or crash recovery.
import {
  applyZoomLevel,
  DEFAULT_ZOOM_LEVEL,
  installZoomReassertOnNavigation,
  installZoomReassertOnWindowEvents,
  percentToZoomLevel,
  ZOOM_STEP,
  ZOOM_STORAGE_KEY,
  zoomLevelToPercent,
  zoomWiringForWindowKind
} from './zoom'

function setAndPersistZoomLevel(window, zoomLevel) {
  if (!window || window.isDestroyed()) {
    return
  }

  // Apply + notify in one funnel so the settings UI stays in sync, including
  // changes made via the keyboard shortcuts or the View menu.
  const next = applyZoomLevel(window.webContents, zoomLevel)

  // Primary store: main-process JSON (survives crash recovery — #56726).
  writeZoomState(next)
  // Secondary mirror: renderer localStorage (legacy store; kept in sync so a
  // downgrade or JSON read failure still finds a sane value).
  window.webContents
    .executeJavaScript(
      `try { localStorage.setItem(${JSON.stringify(ZOOM_STORAGE_KEY)}, ${JSON.stringify(String(next))}) } catch {
      void 0
    }`
    )
    .catch(error => rememberLog(`[zoom] persist failed: ${error?.message || error}`))
}

function restorePersistedZoomLevel(window) {
  if (!window || window.isDestroyed()) {
    return
  }

  // Prefer the JSON file — it survives crash recovery wiping Electron's
  // cache/storage folders (#56726). applyZoomLevel notifies the renderer so
  // the Appearance UI Scale control stays in sync.
  const saved = readZoomState()

  if (saved != null) {
    // Drift-guard: skip when this window already shows the persisted level.
    // Blindly re-applying on every resize/move would race the compositor's
    // surface reconfigure during a Wayland resize storm (Cosmic tiled mode
    // fires one whenever a new session window opens — #84818) and keep the
    // renderer notification stream churning for no gain. The settle-verify
    // chain in installZoomReassertOnWindowEvents re-applies only when the
    // window actually drifted from the persisted level.
    const current = window.webContents?.getZoomLevel?.()

    if (current != null && Math.abs(current - saved) < 1e-9) {
      return
    }

    applyZoomLevel(window.webContents, saved)

    return
  }

  // No JSON yet: paint the shipped default immediately so a fresh install
  // doesn't flash Chromium 100%, then try localStorage for pre-JSON installs
  // and overwrite if a legacy value is there.
  applyZoomLevel(window.webContents, DEFAULT_ZOOM_LEVEL)

  window.webContents
    .executeJavaScript(
      `(() => { try { return localStorage.getItem(${JSON.stringify(ZOOM_STORAGE_KEY)}) } catch { return null } })()`
    )
    .then(stored => {
      if (!window || window.isDestroyed()) {
        return
      }

      const level = stored == null ? DEFAULT_ZOOM_LEVEL : Number(stored)
      const applied = applyZoomLevel(window.webContents, level)
      writeZoomState(applied)
    })
    .catch(error => rememberLog(`[zoom] restore failed: ${error?.message || error}`))
}

function installZoomShortcuts(window) {
  // Override Ctrl/Cmd + +/-/0 with half Chromium's default zoom step (ZOOM_STEP
  // is 0.1 vs Chromium's 0.2). The menu items handle this on macOS (where the
  // menu is always present), but on Linux/Windows the menu is null and
  // Chromium's default handler would use the full 0.2 step, so we intercept
  // here for consistency. Ctrl/Cmd+0 resets to DEFAULT_ZOOM_LEVEL, not Chromium 0.
  window.webContents.on('before-input-event', (event, input) => {
    const action = windowAcceleratorAction(input, IS_MAC)

    if (action === 'zoom-reset') {
      event.preventDefault()
      setAndPersistZoomLevel(window, DEFAULT_ZOOM_LEVEL)
    } else if (action === 'zoom-in') {
      // Zoom-in must accept the shift modifier: on US layouts Plus is
      // physically Shift+=, so Cmd+Plus arrives as Cmd+Shift+'+' (or '='
      // depending on platform). The old blanket shift guard silently
      // dropped keyboard zoom-in on macOS (#43517).
      event.preventDefault()
      setAndPersistZoomLevel(window, window.webContents.getZoomLevel() + ZOOM_STEP)
    } else if (action === 'zoom-out') {
      event.preventDefault()
      setAndPersistZoomLevel(window, window.webContents.getZoomLevel() - ZOOM_STEP)
    }
  })

  // Ctrl/Cmd + mouse wheel — the standard desktop/browser zoom gesture
  // (#40295). Chromium surfaces it as the main-process 'zoom-changed' event
  // (wheel events are DOM-side, so before-input-event never sees them).
  // Route through the same persist+notify funnel as the keyboard shortcuts
  // so wheel zoom survives restarts and the settings Scale control stays in
  // sync, and use the same half step for consistency.
  window.webContents.on('zoom-changed', (event, zoomDirection) => {
    event.preventDefault()
    const delta = zoomDirection === 'in' ? ZOOM_STEP : -ZOOM_STEP
    setAndPersistZoomLevel(window, window.webContents.getZoomLevel() + delta)
  })
}

/**
 * The custom (renderer) context menu's main-process half.
 *
 * The app popups no native menus: the renderer owns the menu UI so labels
 * are translated with the rest of the app. Main keeps only what Chromium
 * reports here and the renderer cannot see:
 *  - spell-check facts (misspelled word + suggestions) — forwarded so the
 *    renderer appends them to its already-open menu,
 *  - the gesture coordinates — kept for copyImageAt, which needs them.
 */
const lastContextMenuPoint = new Map<number, { x: number; y: number }>()

function installContextMenuBridge(window: BrowserWindow) {
  window.webContents.on('context-menu', (_event, params) => {
    lastContextMenuPoint.set(window.webContents.id, { x: params.x, y: params.y })

    const suggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : []

    if (params.isEditable && params.misspelledWord) {
      window.webContents.send('scout:context-menu-spellcheck', {
        misspelledWord: params.misspelledWord,
        suggestions
      })
    }
  })
}

// Microphone and camera capture. The voice composer drives mic access and
// renderer features (e.g. desktop plugins) can drive camera access, both
// through getUserMedia, which Chromium gates behind these two session hooks.
//
// The naive `details.mediaTypes.includes('audio')` check works on macOS but
// breaks on Windows: Chromium frequently fires the request with an empty or
// undefined `mediaTypes`, so a strict check denies it and getUserMedia throws
// NotAllowedError. We therefore allow the capture permissions and treat absent
// metadata as allowed.
//
// Granting here is not the last gate: the OS still applies its own capture
// permission (macOS TCC prompts on first use, per the NSMicrophone/NSCamera
// usage strings), so the user keeps a real allow/deny and can revoke it in
// System Settings afterwards.
function isMediaCapturePermission(permission, details) {
  // HTML5 video/audio fullscreen asks the request handler for 'fullscreen'
  // and the check handler for 'automatic-fullscreen'. Both must be allowed
  // or the native fullscreen button on <video controls> does nothing.
  if (permission === 'fullscreen' || permission === 'automatic-fullscreen') {
    return true
  }

  if (permission === 'audioCapture' || permission === 'videoCapture') {
    return true
  }

  if (permission !== 'media') {
    return false
  }

  const mediaTypes = details?.mediaTypes

  // Windows: mediaTypes is often empty for a capture request. Don't deny on
  // missing metadata.
  if (!Array.isArray(mediaTypes) || mediaTypes.length === 0) {
    return true
  }

  return mediaTypes.includes('audio') || mediaTypes.includes('video')
}

// Chromium-initiated downloads (renderer anchor/blob downloads, drag-outs)
// land here. Without a handler the OS save dialog opens with the process cwd
// as the default directory (win-unpacked in packaged installs) and whatever
// extensionless name the anchor carried. Route every download to the user's
// Downloads directory and guarantee a MIME-derived extension.
function installDownloadHandling() {
  session.defaultSession.on('will-download', (_event, item) => {
    const suggested = item.getFilename() || 'download'
    const hasExtension = Boolean(path.extname(suggested))
    const extension = hasExtension ? '' : extensionForMimeType(item.getMimeType())
    const filename = `${suggested}${extension}`

    try {
      item.setSaveDialogOptions({
        title: 'Save File',
        defaultPath: path.join(app.getPath('downloads'), filename),
        filters:
          extension || /^image\//i.test(item.getMimeType() || '')
            ? [
                { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
                { name: 'All Files', extensions: ['*'] }
              ]
            : undefined
      })
    } catch {
      // No Downloads directory to offer — keep Chromium's default prompt.
    }
  })
}

function installMediaPermissions() {
  // Async request handler: the prompt-style path (most platforms).
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(isMediaCapturePermission(permission, details))
  })

  // Synchronous check handler: Chromium consults this for getUserMedia on
  // Windows in addition to (or instead of) the request handler. Without it,
  // the check defaults to false and capture is denied before the request
  // handler ever runs.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return (
      permission === 'media' ||
      (permission as string) === 'automatic-fullscreen' ||
      permission === ('audioCapture' as any) /* todo: is this needed? */ ||
      permission === ('videoCapture' as any)
    )
  })
}

// ---------------------------------------------------------------------------
// OAuth remote-gateway auth.
//
// Hosted Scout gateways gate the dashboard behind an OAuth provider (e.g.
// SpaceshipResearch) instead of a static session token. The auth model is
// fundamentally different from the token path:
//
//   * REST is authed by HttpOnly session cookies (``scout_session_at``),
//     established by a browser redirect round-trip (/login → IDP →
//     /auth/callback sets cookies). We cannot read the HttpOnly cookie value
//     in JS — instead we let an Electron BrowserWindow complete the round
//     trip into a PERSISTENT session partition, and thereafter route our REST
//     through Electron's ``net`` bound to that same partition so the cookie
//     jar attaches the cookie automatically.
//   * WebSocket upgrades require a single-use ``?ticket=`` minted at
//     ``POST /api/auth/ws-ticket`` (cookie-authed). The legacy ``?token=``
//     path is unconditionally rejected by gated gateways.
//   * Gated gateways issue a 24h ROTATING, reuse-detected refresh token
//     alongside the ~15-min access token. Both are set as HttpOnly cookies (``scout_session_at`` ~15 min,
//     ``scout_session_rt`` 24h). When the AT cookie lapses but the RT cookie
//     is still alive, the gateway middleware transparently rotates a fresh AT
//     on the next authenticated request — so connectivity must NOT be gated on
//     the AT cookie alone. We probe liveness by actually minting a ws-ticket
//     (which triggers that server-side refresh) and treat a real 401 as
//     "needs re-login"; the AT-or-RT cookie presence check is only a cheap
//     "is the user signed in at all?" gate / display signal.
// ---------------------------------------------------------------------------

const OAUTH_SESSION_PARTITION = LEGACY_OAUTH_PARTITION

function getOauthSession() {
  if (oauthSession || !app.isReady()) {
    return oauthSession
  }

  oauthSession = session.fromPartition(OAUTH_SESSION_PARTITION)
  installRemoteHeaderRulesOnSession(oauthSession)

  return oauthSession
}

// Per-connection cookie jars (#92183). A NON-primary v2 registry remote with
// cookie auth rides its own partition so two registered gateways can never
// evict — or be handed — each other's session cookies (Chromium jars ignore
// the port, so two dashboards on one VPN host used to collide in the shared
// jar above). The primary / v1 remote flows keep the legacy shared partition;
// see oauth-partition.ts for the full rules.
const oauthSessionsByPartition = new Map()

function resolveOauthPartitionForUrl(url, { connectionId = '', pendingAuthMode = '', pendingKind = '' } = {}) {
  try {
    return resolveOauthPartition(url, {
      connectionId,
      pendingAuthMode,
      pendingKind,
      registry: readDesktopConnectionsRegistry(),
      v1RemoteUrl: readDesktopConnectionConfig()?.remote?.url
    })
  } catch {
    // A broken registry read must never take cookie auth down with it.
    return OAUTH_SESSION_PARTITION
  }
}

function getOauthSessionForUrl(url, { connectionId = '', pendingAuthMode = '', pendingKind = '' } = {}) {
  const partition = resolveOauthPartitionForUrl(url, { connectionId, pendingAuthMode, pendingKind })

  if (partition === OAUTH_SESSION_PARTITION) {
    return getOauthSession()
  }

  if (!app.isReady()) {
    return null
  }

  let sess = oauthSessionsByPartition.get(partition)

  if (!sess) {
    sess = session.fromPartition(partition)
    oauthSessionsByPartition.set(partition, sess)
    installRemoteHeaderRulesOnSession(sess)
  }

  return sess
}

// Bare + prefixed variants of the session cookies live in
// connection-config.ts (cookiesHaveSession / cookiesHaveLiveSession). See
// that module for details.

// #61457: snapshot a partition jar's session cookies for this gateway into
// the in-memory mirror, keyed by the SAME partition the jar belongs to.
// Best-effort: a failed read just means the next response's Set-Cookie
// capture populates the mirror instead.
async function captureRemoteSessionCookiesIntoMirror(sess, partition, baseUrl) {
  if (!sess || !partition) {
    return
  }

  try {
    remoteSessionCookies.recordFromJar(partition, baseUrl, await sess.cookies.get({ url: baseUrl }))
  } catch (error) {
    rememberLog(`Remote session cookie mirror capture failed: ${error?.message || error}`)
  }
}

async function hasOauthSessionCookie(baseUrl, { connectionId = '', pendingAuthMode = '', pendingKind = '' } = {}) {
  const sess = getOauthSessionForUrl(baseUrl, { connectionId, pendingAuthMode, pendingKind })

  if (!sess) {
    return false
  }

  const parsed = new URL(baseUrl)

  try {
    // Query by URL so the cookie jar applies Domain/Path/Secure scoping for us.
    const cookies = await sess.cookies.get({ url: baseUrl })

    return cookiesHaveSession(cookies)
  } catch {
    // Fall back to a host match if the URL query path errors.
    try {
      const cookies = await sess.cookies.get({ domain: parsed.hostname })

      return cookiesHaveSession(cookies)
    } catch {
      return false
    }
  }
}

// Open a gateway login window in the OAuth session partition, resolving once
// the access-token cookie appears (login done) or rejecting if the user closes
// the window first. The window navigates through the IDP and back to
// /auth/callback, which sets the session cookies on the partition; we poll the
// cookie jar rather than try to read the HttpOnly value.
//
// `silent` selects the URL the window loads, which decides interactive-vs-silent:
//   - silent=false (default): load ``/login`` — the public interstitial that
//     renders the "Log in with X" provider chooser. This is the interactive
//     remote-gateway login the settings UI drives.
//   - silent=true: load the PROTECTED root ``/`` instead. ``/login`` is a public
//     route, so loading it NEVER triggers the gate's auto-SSO and always shows
//     the chooser. Loading a protected page with no session cookie makes the
//     gate run ``_auto_sso_response``: single registered provider + a live
//     identity-provider session in this partition → a silent 302 through
//     ``/auth/login`` → the IdP → ``/auth/callback``, which sets the gateway
//     cookie with NO interactive prompt.
function openOauthLoginWindow(
  baseUrl,
  { silent = false, connectionId = '', pendingAuthMode = '', pendingKind = '' } = {}
) {
  return new Promise((resolve, reject) => {
    // Background work may silently renew a session, but must never turn an
    // expired saved gateway into a visible login window.
    const hiddenRecovery = !canShowInteractiveOauthLogin()

    if (!app.isReady()) {
      reject(new Error('Desktop is not ready to start an OAuth login.'))

      return
    }

    const sess = getOauthSessionForUrl(baseUrl, { connectionId, pendingAuthMode, pendingKind })

    if (!sess) {
      reject(new Error('OAuth session partition is unavailable.'))

      return
    }

    let settled = false
    let win = null
    let pollTimer = null
    let revealTimer = null
    let deadlineTimer = null

    const finish = err => {
      if (settled) {
        return
      }

      settled = true

      if (pollTimer) {
        clearInterval(pollTimer)
      }

      if (revealTimer) {
        clearTimeout(revealTimer)
      }

      if (deadlineTimer) {
        clearTimeout(deadlineTimer)
      }

      try {
        if (win && !win.isDestroyed()) {
          win.destroy()
        }
      } catch {
        // window already torn down
      }

      if (err) {
        reject(err)
      } else {
        // #61457: the jar just got the fresh session cookies — mirror them
        // into memory immediately, before the jar can drop them again.
        void captureRemoteSessionCookiesIntoMirror(
          sess,
          resolveOauthPartitionForUrl(baseUrl, { connectionId, pendingAuthMode, pendingKind }),
          baseUrl
        )
        resolve({ baseUrl, ok: true })
      }
    }

    const checkCookie = async () => {
      if (settled) {
        return
      }

      if (await hasOauthSessionCookie(baseUrl, { connectionId, pendingAuthMode, pendingKind })) {
        finish(null)
      }
    }

    try {
      win = new BrowserWindow({
        width: 520,
        height: 720,
        title: silent ? 'Reconnecting to Scout gateway…' : 'Sign in to Scout gateway',
        autoHideMenuBar: true,
        // Silent cascade: start HIDDEN. The auto-SSO 302 chain completes in
        // well under a second, so the window normally never needs to show. We
        // only reveal it as a fallback if the cascade DOESN'T complete quickly
        // (e.g. the IdP session lapsed and the gate fell through to the
        // interactive chooser) — see the reveal timer below.
        show: !silent && !hiddenRecovery,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          session: sess,
          webSecurity: true
        }
      })
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))

      return
    }

    // Re-check the cookie jar on every successful navigation (the callback
    // redirect is the moment cookies get set) plus a low-frequency poll as a
    // belt-and-braces fallback for IDPs that finish via in-page JS.
    win.webContents.on('did-navigate', () => void checkCookie())
    win.webContents.on('did-redirect-navigation', () => void checkCookie())
    win.webContents.on('did-frame-navigate', () => void checkCookie())
    // Log-only lifecycle diagnostics: a crashed sign-in renderer is invisible
    // to the window's promise path (it never settles), so without this the
    // failure leaves no trace in desktop.log (#81290 follow-up).
    installWindowRendererLifecycle(win, { kind: 'oauth', callbacks: { log: rememberLog } })
    pollTimer = setInterval(() => void checkCookie(), 750)

    // Silent-mode reveal fallback: if the cascade hasn't settled shortly, the
    // auto-SSO didn't go through silently (no IdP session, multi-provider,
    // loop-guard tripped, etc.) and the window is now showing an interactive
    // page. Reveal it so the user can complete sign-in manually rather than
    // staring at nothing. Cleared on finish().
    if (silent && win && !hiddenRecovery) {
      revealTimer = setTimeout(() => {
        try {
          if (!settled && win && !win.isDestroyed() && !win.isVisible()) {
            win.show()
          }
        } catch {
          // window torn down
        }
      }, 2500)
    }

    if (hiddenRecovery) {
      deadlineTimer = setTimeout(() => finish(new Error('Gateway session recovery requires sign-in.')), 12_000)
    }

    win.on('closed', () => {
      if (!settled) {
        finish(new Error('Login window closed before authentication completed.'))
      }
    })

    // ``next`` is intentionally omitted: the gateway lands on ``/`` after
    // login, which is a valid authenticated page that sets the cookies. We
    // only care that the cookie jar is populated.
    //
    // silent=true loads the protected root so the gate auto-SSOs (no chooser);
    // silent=false loads the public ``/login`` chooser for interactive sign-in.
    const normalizedBase = normalizeRemoteBaseUrl(baseUrl)
    const loginUrl = silent ? `${normalizedBase}/` : `${normalizedBase}/login`
    const loginHeaders = headersForRemoteRequest(loginUrl)
    rememberLog(
      `OAuth login: attaching ${Object.keys(loginHeaders).length} extra gateway header(s) to ${new URL(normalizedBase).host}`
    )
    win.loadURL(loginUrl, oauthLoginLoadUrlOptions(loginHeaders)).catch(error => {
      // Callback navigation can abort the original load after setting cookies.
      // Keep the bounded hidden recovery alive long enough to observe them.
      if (hiddenRecovery && isExpectedOauthNavigationAbort(error)) {
        void checkCookie()

        return
      }

      finish(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

// JSON request routed through the OAuth session partition so the HttpOnly
// session cookie is attached automatically by Electron's net stack. Used for
// authed REST against a gated gateway, including minting WS tickets.
//
// #61457: the partition's Chromium jar is not a reliable cookie source — it can
// drop the `scout_session*` cookies (Windows %3A profile folders, lazy
// hydration, flush races) and `useSessionCookies: true` then intermittently
// omits the cookie → 401 `no_cookie` right after a successful sign-in. Two
// mitigations, both keyed by the request's resolved OAuth partition + origin
// (the same owner the jar itself is scoped to, so same-origin gateways on
// separate jars stay separate here too):
//   1. an explicit `Cookie` header built from the in-memory session-cookie
//      mirror (remote-session-cookies.ts) — an explicit header bypasses the
//      network stack's jar lookup entirely, and every `Set-Cookie` observed
//      here (and in the login window) feeds the mirror back; and
//   2. one forced silent re-login + single retry when the gateway still
//      answers 401 — ONLY when shouldReplayAfterCookie401 holds: the 401 is
//      the auth gate's pre-handler refusal AND the operation is idempotent or
//      vouched replay-safe (`options.replayOn401`). Anything else keeps the
//      no-replay rule of requestWithOauthFallback.
function fetchJsonViaOauthSession(url, options: any = {}) {
  const partition = resolveOauthPartitionForUrl(url)

  const attempt = (): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const sess = getOauthSessionForUrl(url)

      if (!sess) {
        reject(new Error('OAuth session partition is unavailable.'))

        return
      }

      let parsed

      try {
        parsed = new URL(url)
      } catch (error) {
        reject(new Error(`Invalid URL: ${error.message}`))

        return
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        reject(new Error(`Unsupported Scout backend URL protocol: ${parsed.protocol}`))

        return
      }

      const body = serializeJsonBody(options.body)
      const timeoutMs = resolveTimeoutMs(options.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS)

      const request = electronNet.request({
        method: options.method || 'GET',
        url,
        session: sess,
        useSessionCookies: true,
        redirect: 'follow'
      } as any)

      setJsonRequestHeaders(request)

      const headerBag = { ...headersForRemoteRequest(url), ...(options.headers || {}) }

      // Explicit mirror cookies ride last so an existing caller-supplied
      // Cookie header still wins, and the mirror never clobbers intent.
      const mirroredCookies = remoteSessionCookies.cookieHeaderFor(partition, url)

      if (mirroredCookies && headerBag.Cookie === undefined && headerBag.cookie === undefined) {
        headerBag.Cookie = mirroredCookies
      }

      for (const [name, value] of Object.entries(headerBag)) {
        request.setHeader(name, String(value))
      }

      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true

        try {
          request.abort()
        } catch {
          // already finished
        }

        reject(new Error(`Timed out connecting to Scout backend after ${timeoutMs}ms`))
      }, timeoutMs)

      request.on('response', (res: Electron.IncomingMessage): void => {
        wireOauthSessionResponse(res, {
          url,
          isTimedOut: (): boolean => timedOut,
          clearTimer: (): void => clearTimeout(timer),
          resolve,
          reject,
          onSetCookies: setCookie => remoteSessionCookies.record(partition, url, setCookie)
        })
      })
      request.on('error', error => {
        if (timedOut) {
          return
        }

        clearTimeout(timer)
        reject(error)
      })

      if (body) {
        request.write(body)
      }

      request.end()
    })

  return attempt().catch(async error => {
    return retryCookie401WithLogin(error, options, {
      clearCookies: () => remoteSessionCookies.clear(partition, url),
      login: async () => {
        try {
          await openOauthLoginWindow(new URL(url).origin, { silent: true })
        } catch (reloginError) {
          rememberLog(
            `Remote session re-login after 401 failed for ${new URL(url).host}: ${reloginError?.message || reloginError}`
          )
          throw reloginError
        }
      },
      retry: attempt
    })
  })
}

// ---------------------------------------------------------------------------
// RFC 8252 native-app tokens (system-browser + loopback + PKCE).
//
// Unlike the cookie flow, the native flow hands the desktop opaque bearer
// tokens it holds itself: the access token authenticates REST via
// ``Authorization: Bearer`` (which the gateway gate now accepts) and mints WS
// tickets the same way, so NO browser session cookie or embedded webview is
// involved. Tokens are persisted encrypted at rest via Electron ``safeStorage``
// (OS keychain) keyed by gateway base URL, and refreshed via
// ``/auth/native/refresh`` before expiry. This is the desktop half of the
// feature; the server half lives in scout_backend/dashboard_auth/native_flow.py.
// ---------------------------------------------------------------------------

// In-memory cache of decrypted native tokens, keyed by normalized base URL.
// Backed by the encrypted on-disk store so it survives restarts.
const _nativeTokens = new Map<string, NativeTokenSet>()

function _nativeTokenStorePath() {
  // Co-located with the connection config under userData; one JSON file mapping
  // baseUrl → { encoding, value } safeStorage payloads.
  return path.join(app.getPath('userData'), 'native-oauth-tokens.json')
}

// The electron-coupled half of the token store: safeStorage encryption plus the
// userData file. native-token-store.ts owns the serialization/parse round trip
// so it can be tested without an Electron runtime.
function _nativeTokenStoreIo(): NativeTokenStoreIo {
  return {
    encrypt: encryptDesktopSecret,
    decrypt: decryptDesktopSecret,
    readStoreText: () => fs.readFileSync(_nativeTokenStorePath(), 'utf8'),
    writeStoreText: (text: string) => {
      fs.mkdirSync(path.dirname(_nativeTokenStorePath()), { recursive: true })
      fs.writeFileSync(_nativeTokenStorePath(), text, { mode: 0o600 })
    },
    rememberLog
  }
}

function _persistNativeTokens(baseUrl: string, tokens: NativeTokenSet | null) {
  persistNativeTokenSet(baseUrl, tokens, _nativeTokenStoreIo())
}

function _loadNativeTokens(baseUrl: string): NativeTokenSet | null {
  baseUrl = normalizeRemoteBaseUrl(baseUrl)
  const cached = _nativeTokens.get(baseUrl)

  if (cached) {
    return cached
  }

  const tokens = loadNativeTokenSet(baseUrl, _nativeTokenStoreIo())

  if (tokens) {
    _nativeTokens.set(baseUrl, tokens)
  }

  return tokens
}

function _storeNativeTokens(baseUrl: string, tokens: NativeTokenSet) {
  _persistNativeTokens(baseUrl, tokens)
  _nativeTokens.set(baseUrl, tokens)
}

function _clearNativeTokens(baseUrl: string) {
  _nativeTokens.delete(baseUrl)
  _persistNativeTokens(baseUrl, null)
}

// True when we hold native bearer tokens for this gateway (the native-flow
// analogue of hasLiveOauthSession's cookie check).
function hasNativeSession(baseUrl: string): boolean {
  return _loadNativeTokens(baseUrl) !== null
}

// POST JSON WITHOUT the OAuth cookie partition — used for the native token +
// refresh exchanges, which are cookieless by design. Thin wrapper over
// fetchJson (no token) so it shares timeout/JSON handling.
function postJsonNoAuth(url: string, body: unknown, opts: any = {}) {
  // resolveJsonBody passes the object through UNCHANGED — fetchJson owns
  // JSON.stringify. Pre-stringifying here double-encodes the body (a JSON
  // string inside a JSON string), which the gateway's Pydantic model rejects
  // with a 422 "Input should be a valid dictionary" (the native
  // /auth/native/token + /auth/native/refresh legs both go through here).
  return fetchJson(url, null, { method: 'POST', body: resolveJsonBody(body), ...opts })
}

// All explicit mutations go through the coordinator; only its refresh/store
// dependencies may call the raw persistence helpers above. It single-flights
// the /auth/native/refresh rotation per host (concurrent callers share one
// flight instead of racing rotations and losing the winner) and fences a
// refresh that lands after a login/logout changed the identity underneath it
// (22751c8fd9b9). A 401 on refresh means the RT is dead — tokens are dropped
// so the UI prompts a fresh native login; a 503/transient keeps them.
const nativeAccessTokenCoordinator: ReturnType<typeof createNativeAccessTokenCoordinator> =
  createNativeAccessTokenCoordinator({
    clearTokens: _clearNativeTokens,
    isRefreshAuthRejection: (error: unknown): boolean => readStatusCode(error) === 401,
    loadTokens: _loadNativeTokens,
    normalizeBaseUrl: normalizeRemoteBaseUrl,
    refreshTokens: async (baseUrl: string, tokens: NativeTokenSet): Promise<NativeTokenSet> =>
      parseTokenResponse(
        await postJsonNoAuth(
          nativeRefreshUrl(baseUrl),
          { refresh_token: tokens.refreshToken, provider: tokens.provider },
          { timeoutMs: 10_000 }
        )
      ),
    storeTokens: _storeNativeTokens,
    tokenNeedsRefresh
  })

// Return a valid native access token for baseUrl, refreshing via
// /auth/native/refresh if the stored one is at/near expiry. Returns null when
// there are no tokens or the refresh is terminally rejected (caller re-logins).
const ensureNativeAccessToken: (baseUrl: string, options?: NativeAccessTokenOptions) => Promise<string | null> =
  nativeAccessTokenCoordinator.ensure

interface GatewayFileConnection extends RegistryBackendRequestScope {
  authMode?: 'oauth' | 'token'
  baseUrl: string
  token?: null | string
}

interface GatewayFileSavePayload {
  sessionId?: string
  connectionId?: unknown
  path?: unknown
  profile?: unknown
  suggestedName?: unknown
}

function gatewayFileRequestPath(
  connection: GatewayFileConnection,
  connectionId: null | string,
  profile: null | string,
  requestPath: string
): string {
  return connectionId
    ? pathForRegistryBackendRequest(requestPath, profile, connection)
    : pathWithGlobalRemoteProfile(requestPath, profile, profileRouteOptions(profile))
}

async function saveGatewayFile(payload: GatewayFileSavePayload = {}): Promise<GatewayFileSaveResult> {
  const filePath = gatewayFilePath(payload.path)

  if (!filePath) {
    throw new Error('Missing gateway file path')
  }

  const { connection, connectionId, profile } = await resolveGatewayFileBackend<GatewayFileConnection>(payload, {
    ensureLegacy: ensureBackend,
    ensureRegistry: ensureRegistryBackend
  })

  const suggested = String(payload.suggestedName || '').trim()
  const fallbackName = path.basename(filePath) || suggested || 'download'
  const ctx: GatewayFileSaveContext = { suggested, fallbackName }

  const requestPaths = gatewayFileRequestPaths(
    filePath,
    requestPath => gatewayFileRequestPath(connection, connectionId, profile, requestPath),
    payload.sessionId
  )

  const deps: GatewayFileSaveDeps = {
    showSaveDialog: (options: GatewaySaveDialogOptions): Promise<GatewaySaveDialogResult> =>
      dialog.showSaveDialog(mainWindow, options)
  }

  return saveGatewayDownload(requestPaths, ctx, {
    ...deps,
    download: async (requestPath: string, context: GatewayFileSaveContext): Promise<GatewayFileSaveResult> => {
      const url: string = `${connection.baseUrl}${requestPath}`

      if (connection.authMode === 'oauth') {
        return requestWithOauthFallback(connection.baseUrl, {
          ensureNativeAccessToken,
          requestWithBearer: (bearer: string): Promise<GatewayFileSaveResult> =>
            downloadViaTokenToFile(url, null, context, deps, { bearer }),
          requestWithCookie: (): Promise<GatewayFileSaveResult> =>
            downloadViaOauthSessionToFile<Session>(url, context, {
              ...deps,
              getSession: getOauthSessionForUrl,
              request: electronNet.request
            })
        })
      }

      return downloadViaTokenToFile(url, connection.token ?? null, context, deps)
    },
    readDataUrl: (requestPath: string): Promise<string> => readGatewayFileDataUrl(connection, requestPath)
  })
}

async function readGatewayFileDataUrl(connection: GatewayFileConnection, requestPath: string): Promise<string> {
  const json: unknown = await fetchJsonForBackend(connection, requestPath)

  const dataUrl =
    json && typeof json === 'object' && 'dataUrl' in json && typeof json.dataUrl === 'string' ? json.dataUrl : ''

  if (!dataUrl) {
    throw new Error('Gateway returned no file data')
  }

  return dataUrl
}

// Native bearer first (including one forced 401 rotation), OAuth cookie second.
// Transient ticket POST failures keep their bounded retry.
async function mintGatewayWsTicket(baseUrl: string, headers: Record<string, string> = {}): Promise<string> {
  return withTransientRetries(
    (): Promise<string> =>
      mintOauthGatewayWsTicket(baseUrl, { ensureNativeAccessToken, fetchJson, fetchJsonViaOauthSession }, headers),
    {
      isRetryable: (error: Error): boolean =>
        !(error instanceof NativeAuthChangedError) && !isGatewayAuthRejection(error)
    }
  )
}

// Build a fresh WS URL for the *current* connection. Critical for reconnects:
// OAuth WS tickets are single-use with a ~30s TTL, so the ticket baked into
// the cached connection's wsUrl is stale on the second connect. The renderer
// calls this immediately before every gateway.connect() so each WS upgrade
// carries a freshly-minted ticket. For local/token connections this just
// reuses the static token (no minting needed).
async function freshGatewayWsUrl(profile) {
  // Mint for the requested profile's backend, NOT always the primary. The
  // renderer re-mints right before every gateway.connect(); when swapping to a
  // pooled profile we must return THAT backend's ws URL, otherwise the connect
  // silently lands back on the primary (default) backend and writes sessions to
  // the wrong profile's DB. A null/empty profile resolves to the primary, so
  // legacy callers and single-profile users are unchanged.
  const connection = await ensureBackend(profile)

  if (connection.authMode === 'oauth') {
    const ticket = await mintGatewayWsTicket(connection.baseUrl, connection.headers)
    const wsUrl = buildGatewayWsUrlWithTicket(connection.baseUrl, ticket)

    rememberRemoteWsHeaders(wsUrl, connection.headers)

    return wsUrl
  }

  // Local/token: the cached wsUrl already carries the (long-lived) token.
  rememberRemoteWsHeaders(connection.wsUrl, connection.headers)

  return connection.wsUrl
}

// ---------------------------------------------------------------------------
// Opt-in keychain encryption (secret-storage-policy.ts owns the decision).
// Default OFF: no safeStorage call is ever made, so a broken/locked macOS
// login keychain can never throw its password dialog on launch. Settings →
// Gateway exposes the toggle; flipping it re-encrypts (or decrypts) the
// stored secrets in place.
// ---------------------------------------------------------------------------
const SECRET_STORAGE_POLICY_PATH = path.join(app.getPath('userData'), SECRET_STORAGE_POLICY_FILE)

const _secretStoragePolicyIo = {
  readText: () => fs.readFileSync(SECRET_STORAGE_POLICY_PATH, 'utf8'),
  writeText: (text: string) => writeSecretFileAtomic(SECRET_STORAGE_POLICY_PATH, text, { encoding: 'utf8' })
}

let _secretStoragePolicy: SecretStoragePolicy | null = null

function secretStoragePolicy(): SecretStoragePolicy {
  if (!_secretStoragePolicy) {
    _secretStoragePolicy = readSecretStoragePolicy(_secretStoragePolicyIo)
  }

  return _secretStoragePolicy
}

function setSecretStoragePolicy(next: SecretStoragePolicy) {
  _secretStoragePolicy = { on: next.on === true, migrated: next.migrated === true }
  writeSecretStoragePolicy(_secretStoragePolicy, _secretStoragePolicyIo)
}

/**
 * Rewrite every stored desktop secret (the native OAuth token store) through
 * `reencode`. Returns true when any store was rewritten. Shared by the
 * one-shot legacy migration and the Settings encryption toggle.
 */
function rewriteAllStoredSecrets(shouldRewrite: (secret: any) => boolean, reencode: (secret: any) => any): boolean {
  let touched = false

  // Native OAuth token store: baseUrl → blob.
  const io = _nativeTokenStoreIo()

  try {
    const store = JSON.parse(io.readStoreText())

    if (store && typeof store === 'object' && !Array.isArray(store)) {
      const entries = Object.entries(store)

      if (entries.some(([, v]) => shouldRewrite(v))) {
        touched = true
        io.writeStoreText(JSON.stringify(Object.fromEntries(entries.map(([k, v]) => [k, reencode(v)]))))
      }
    }
  } catch {
    // Missing/corrupt native token store: nothing to rewrite.
  }

  return touched
}

/**
 * One-shot legacy migration: builds before the opt-in policy wrote every
 * secret as a safeStorage blob. With encryption now defaulting OFF, decrypt
 * each stored blob once and rewrite it as plain so no future launch touches
 * the keychain. Marked `migrated` whether or not every blob decrypts — a
 * broken keychain costs at most ONE prompt (this pass), never one per
 * launch; blobs that would not decrypt are left in place and simply read as
 * absent from then on (classifyStoredSecret → 'drop'), so opting encryption
 * back ON later can still recover them on a healthy keychain.
 *
 * Runs before createWindow() so every later read sees the final encodings.
 */
function migrateLegacyEncryptedSecretsOnce() {
  const policy = secretStoragePolicy()

  if (policy.on || policy.migrated) {
    return
  }

  const needsMigration = (secret: any) => classifyStoredSecret(secret, policy) === 'migrate'

  const reencode = (secret: any) => {
    if (!needsMigration(secret)) {
      return secret
    }

    const plaintext = decryptDesktopSecret(secret)

    // Undecryptable now (locked/absent keychain): keep the blob for a
    // potential future opt-in, but post-migration reads treat it as unset.
    return plaintext ? { encoding: 'plain', value: plaintext } : secret
  }

  let touchedKeychain = false

  try {
    touchedKeychain = rewriteAllStoredSecrets(needsMigration, reencode)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)

    rememberLog(`[secret-storage] legacy migration pass failed: ${detail}`)
  }

  setSecretStoragePolicy({ on: false, migrated: true })

  if (touchedKeychain) {
    rememberLog('[secret-storage] migrated legacy keychain-encrypted secrets to opt-out storage (one-shot pass)')
  }
}

/**
 * Settings → Gateway toggle: flip keychain-backed encryption and re-encode
 * every stored secret to match. Turning ON encrypts plain blobs through
 * strict safeStorage (throws loudly when the keychain is unusable — the
 * toggle stays off and the renderer shows the error). Turning OFF decrypts
 * back to plain; this is user-initiated, so a keychain prompt here is
 * expected and acceptable.
 */
function applySecretStorageEncryption(on: boolean) {
  const enable = on === true

  if (secretStoragePolicy().on === enable) {
    return { on: enable }
  }

  if (enable) {
    const needsEncrypt = (secret: any) => secret?.encoding === 'plain' && Boolean(secret.value)

    // Probe FIRST so an unusable keychain fails before any store is touched.
    if (
      !(() => {
        try {
          return Boolean(safeStorage.isEncryptionAvailable())
        } catch {
          return false
        }
      })()
    ) {
      throw new Error(
        'OS keychain encryption is unavailable on this machine, so stored gateway secrets cannot be encrypted.'
      )
    }

    setSecretStoragePolicy({ on: true, migrated: true })

    try {
      rewriteAllStoredSecrets(needsEncrypt, secret =>
        needsEncrypt(secret) ? encryptDesktopSecretStrict(String(secret.value), safeStorage) : secret
      )
    } catch (error) {
      // Encryption failed midway: revert the policy so reads keep working
      // against whatever encodings are on disk (mixed stores read fine —
      // decryptDesktopSecret handles both encodings under either policy).
      setSecretStoragePolicy({ on: false, migrated: true })
      throw error
    }

    return { on: true }
  }

  // Turning OFF: decrypt everything back to plain while the keychain is
  // still readable, then flip the policy.
  const needsDecrypt = (secret: any) => secret?.encoding === SAFE_STORAGE_ENCODING

  rewriteAllStoredSecrets(needsDecrypt, (secret: any) => {
    if (!needsDecrypt(secret)) {
      return secret
    }

    const plaintext = decryptDesktopSecret(secret)

    return plaintext ? { encoding: 'plain', value: plaintext } : secret
  })

  setSecretStoragePolicy({ on: false, migrated: true })

  return { on: false }
}

function encryptDesktopSecret(value, options = {}) {
  if (!secretStoragePolicy().on) {
    const raw = String(value || '')

    return raw ? { encoding: 'plain', value: raw } : null
  }

  return encryptDesktopSecretStrict(value, safeStorage, options)
}

function decryptDesktopSecret(secret) {
  if (!secret || typeof secret !== 'object') {
    return ''
  }

  const value = String(secret.value || '')

  if (!value) {
    return ''
  }

  if (secret.encoding === SAFE_STORAGE_ENCODING) {
    // Legacy blob under an opted-out policy: once the one-shot migration pass
    // has run, never touch safeStorage again — a dead keychain would otherwise
    // prompt on every read. Before that pass, decryption is allowed so the
    // migration itself (and this launch's reads) can recover the value.
    if (classifyStoredSecret(secret, secretStoragePolicy()) === 'drop') {
      return ''
    }

    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      return ''
    }
  }

  // Any other encoding (a hand-edited config, or one written by a pre-release
  // build) is returned verbatim on purpose: this fallback is what lets such a
  // config connect at all. Not a plaintext-writing path — nothing in this file
  // persists a token this way.
  return value
}

function decryptRemoteHeaders(headers) {
  const normalized = normalizeRemoteHeaders(headers)
  const out = {}

  for (const [name, secret] of Object.entries(normalized)) {
    // Sanitize AFTER decryption as well as at ingest: a safeStorage envelope
    // stores ciphertext, so normalizeRemoteHeaders never sees its plaintext.
    // This is the single funnel every consumer of header values goes through
    // (login window extraHeaders, onBeforeSendHeaders, electronNet setHeader,
    // and both connection-test paths), so CR/LF can't reach a request here.
    const value = sanitizeRemoteHeaderValue(decryptDesktopSecret(secret))

    if (value) {
      out[name] = value
    }
  }

  return out
}

function rememberRemoteWsHeaders(wsUrl, headers = {}) {
  remoteWsHeaderStore.remember(wsUrl, headers)
}

// Decrypted header sources, memoized against the two config caches this
// process already keys off mtime. onBeforeSendHeaders now runs on every OAuth
// partition as well as defaultSession, so without this every subresource
// request would decrypt EVERY registry connection's headers — and a
// safeStorage-encoded value costs a keychain round-trip per read.
// Both readers refresh their cache object whenever the file mtime moves, so
// identity comparison on the cached objects is a correct staleness check.
let remoteHeaderSourcesCache: any = null
let remoteHeaderSourcesConfigKey: any = null
let remoteHeaderSourcesRegistryKey: any = null

function remoteHeaderSources() {
  const config = readDesktopConnectionConfig()
  const registry = readDesktopConnectionsRegistry()

  if (
    remoteHeaderSourcesCache &&
    remoteHeaderSourcesConfigKey === config &&
    remoteHeaderSourcesRegistryKey === registry
  ) {
    return remoteHeaderSourcesCache
  }

  const sources = collectRemoteHeaderSources({
    connections: (registry?.connections || []).map(entry => ({
      kind: entry.kind,
      url: entry.url,
      headers: decryptRemoteHeaders(entry.headers)
    })),
    v1Remote:
      modeIsRemoteLike(config.mode) && config.remote?.url
        ? { url: config.remote.url, headers: decryptRemoteHeaders(config.remote.headers) }
        : null
  })

  remoteHeaderSourcesCache = sources
  remoteHeaderSourcesConfigKey = config
  remoteHeaderSourcesRegistryKey = registry

  return sources
}

function headersForRemoteRequest(requestUrl) {
  return resolveRemoteRequestHeaders(requestUrl, {
    exactHeaders: remoteWsHeaderStore.headersFor(requestUrl),
    sources: remoteHeaderSources()
  })
}

function installRemoteHeaderRulesOnSession(sess) {
  if (!sess || remoteHeaderSessions.has(sess)) {
    return
  }

  remoteHeaderSessions.add(sess)
  attachRemoteRequestHeaderListener(sess, headersForRemoteRequest)
}

function installRemoteHeaderRules() {
  installRemoteHeaderRulesOnSession(session.defaultSession)
}

// The app has no connection settings of its own: one hosted backend, fixed at build time.
function readDesktopConnectionConfig(): any {
  return { mode: 'remote', remote: { url: HOSTED_BACKEND_URL, authMode: 'token' }, profiles: {} }
}

function readDesktopConnectionsRegistry(): any {
  return hostedConnectionsRegistry()
}

// Last-used profile and explicit app-wide default share the existing desktop
// preference file, but only the explicit action changes the default route.
const desktopProfilePreferences = createDesktopProfilePreferences(DESKTOP_PROFILE_CONFIG_PATH, {
  validateRoute: validateDesktopProfileRoute,
  onDefaultChanged: route => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) {
        win.webContents.send('scout:profile:default:changed', route)
      }
    }
  }
})

function validateDesktopProfileRoute(route: DesktopProfileRoute) {
  if (
    route.connectionId &&
    !readDesktopConnectionsRegistry().connections.some((source: { id: string }) => source.id === route.connectionId)
  ) {
    throw new Error(`No connection with id "${route.connectionId}".`)
  }
}

function readActiveDesktopProfile() {
  return desktopProfilePreferences.readActive()
}

function writeActiveDesktopProfile(name: string | null): string | null {
  return desktopProfilePreferences.remember(name)
}

// True when the given pid belongs to a running process whose command line
// contains "scout", avoiding false positives from stale gateway.pid files
// whose PID was recycled by the OS to an unrelated process.
function isScoutProcess(pid) {
  try {
    process.kill(pid, 0) // signal 0 = existence check, no signal sent
  } catch {
    return false
  }

  // On macOS / Linux, check the command line to avoid PID recycling false positives.
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')

    return cmdline.includes('scout')
  } catch {
    // /proc not available (macOS) — fall back to ps. Use -o args= to inspect
    // the full command line, not just the process name.  -o comm= would return
    // "python3" for any Python process, creating false positives.
    try {
      const { execSync } = require('child_process')
      const out = execSync(`ps -p ${pid} -o args=`, { encoding: 'utf8', timeout: 2000 })

      return out.includes('scout')
    } catch {
      return false
    }
  }
}

// Seed active-profile.json from the best available signal when the file does
// not yet exist.  Runs exactly once (no-op once the file exists).  Priority:
//   1. Legacy ~/.scout/active_profile (explicit CLI choice via scout profile use)
//   2. Running gateway (gateway.pid with verified liveness + scout identity)
//   3. state.db heuristics (hybrid recency×size score picks the primary workspace)
// The stored JSON includes _migrated:true so the renderer can optionally surface
// a one-time notification that the profile was auto-detected.
//
// Decision logic lives in profile-migration.ts (pure + unit-tested). This wrapper
// just wires Electron/Node fs into a MigrationDeps bag and delegates.
function migrateActiveProfileIfMissing() {
  migrateActiveProfileIfMissingPure(DESKTOP_PROFILE_CONFIG_PATH, {
    legacyActivePath: path.join(SCOUT_HOME, 'active_profile'),
    scoutHome: SCOUT_HOME,
    profilesRoot: path.join(SCOUT_HOME, 'profiles'),
    existsSync: p => fs.existsSync(p),
    readFileSync: (p, enc) => fs.readFileSync(p, enc),
    statSync: p => fs.statSync(p),
    readdirSync: (p, opts) => fs.readdirSync(p, opts as { withFileTypes: true }),
    isScoutProcess,
    now: () => Date.now(),
    writeJson: (target, decision) => {
      // Mirror writeActiveDesktopProfile's atomic-write + parent-dir-create
      // semantics so the migration produces a file indistinguishable from a
      // user-driven profile switch.
      fs.mkdirSync(path.dirname(target), { recursive: true })
      writeFileAtomic(target, JSON.stringify(decision, null, 2))
    },
    isValidProfileName: p => PROFILE_NAME_RE.test(p)
  })
}

// Build a remote backend connection descriptor from an already-resolved remote
// config. Handles both auth models (OAuth ws-ticket vs static session token)
// and is shared by the per-profile, env, and global resolution paths. `token`
// is the DECRYPTED static token (or null in OAuth mode). `source` is a label
// for diagnostics ('profile' | 'env' | 'settings').
async function buildRemoteConnection(
  rawUrl,
  authMode,
  token,
  source,
  remoteHost?,
  remoteKind = 'url',
  remoteIdentity?,
  headers?
) {
  const baseUrl = normalizeRemoteBaseUrl(rawUrl)
  const remoteHeaders = decryptRemoteHeaders(headers)
  // For token/oauth remotes the meaningful host is the real backend URL; for
  // SSH remotes the caller passes the entered/resolved host explicitly (the
  // baseUrl is a 127.0.0.1 tunnel and would be useless in the pill).
  const host = remoteHost || hostLabelFromBaseUrl(baseUrl)

  if (authMode === 'oauth') {
    const ticket = await resolveRemoteOauthTicket(baseUrl, remoteHeaders, {
      hasNativeSession,
      mintGatewayWsTicket
    })

    const wsUrl = buildGatewayWsUrlWithTicket(baseUrl, ticket)

    rememberRemoteWsHeaders(wsUrl, remoteHeaders)

    return {
      baseUrl,
      mode: 'remote',
      source,
      authMode: 'oauth' as const,
      remoteHost: host || undefined,
      remoteIdentity,
      remoteKind,
      headers: remoteHeaders,
      // No static token in OAuth mode; REST is cookie-authed via the partition.
      token: null,
      wsUrl
    }
  }

  if (!token) {
    throw new Error(
      'Remote Scout gateway is selected, but no session token is saved. ' +
        'Open Settings → Gateway and save a token, or switch back to Local.'
    )
  }

  const wsUrl = buildGatewayWsUrl(baseUrl, token)

  rememberRemoteWsHeaders(wsUrl, remoteHeaders)

  return {
    baseUrl,
    mode: 'remote',
    source,
    authMode: 'token' as const,
    remoteHost: host || undefined,
    remoteIdentity,
    remoteKind,
    headers: remoteHeaders,
    token,
    wsUrl
  }
}

// Loopback reach for the browser pane. Scoped to the SSH connection that
// authorized it: a different host (or none) must never inherit live forwards
// into somebody else's machine.
const previewReachByWebContents = new Map<number, { registry: PreviewReachRegistry; scope: string }>()

async function resetPreviewReach(webContentsId?: number) {
  if (typeof webContentsId === 'number') {
    const current = previewReachByWebContents.get(webContentsId)

    previewReachByWebContents.delete(webContentsId)

    if (current) {
      await current.registry.closeAll()
    }

    return
  }

  const open = [...previewReachByWebContents.values()]

  previewReachByWebContents.clear()
  await Promise.allSettled(open.map(entry => entry.registry.closeAll()))
}

// The hosted backend has no tunnel to borrow, so a preview URL is loaded as is;
// the pane explains an unreachable one on its own.
async function reachablePreviewUrl(_webContentsId: number, rawUrl: string): Promise<string> {
  return rawUrl
}

// Resolve the hosted backend connection; it serves every profile.
async function resolveRemoteBackend(
  _profile?,
  _options: { forceRegistryPrimary?: boolean; poolKey?: string; primary?: boolean } = {}
) {
  // `scout serve` injects its session token into the page it serves.
  const token = await resolveServedDashboardToken(HOSTED_BACKEND_URL, null, { rememberLog })

  if (!token) {
    throw new Error(`The Scout backend at ${HOSTED_BACKEND_URL} did not provide a session token.`)
  }

  return buildRemoteConnection(HOSTED_BACKEND_URL, 'token', token, 'hosted')
}

// One hosted backend serves every profile via ?profile=.
function globalRemoteActive() {
  return true
}

function primaryBackendIsRemote() {
  return true
}

function resetBootProgressForReconnect() {
  updateBootProgress(
    {
      error: null,
      message: 'Restarting desktop connection',
      phase: 'backend.resolve',
      progress: 4,
      running: true
    },
    { allowDecrease: true }
  )
}

// Reset routing and UI state only. Local callers must await physical teardown.
// Remote revalidation has no local child and can reset this state directly.
function resetScoutConnectionState({ soft = false }: { soft?: boolean } = {}): void {
  backendStartFailure = null
  remoteReauthFailure = null
  remoteLiveness.clear()
  // The next startScout() re-reads active-profile.json for its launch profile.
  primaryProfilePin.clear()
  invalidatePrimaryConnection()

  if (!soft) {
    resetBootProgressForReconnect()
  }
}

function invalidatePrimaryConnection() {
  return backendConnectionState.invalidate()
}

// Drop the hosted connection so the next startScout() dials again.
async function teardownPrimaryBackendAndWait({ soft = false }: { soft?: boolean } = {}): Promise<void> {
  resetScoutConnectionState({ soft })
}

function sendConnectionApplied() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const { webContents } = mainWindow

  if (!webContents || webContents.isDestroyed()) {
    return
  }

  webContents.send('scout:connection:applied')
}

// The profile the primary (window) backend was actually LAUNCHED as. Pinned by
// startScout() and cleared when the primary is torn down; while a primary is
// live this must NOT follow active-profile.json (see primary-profile-pin.ts).
const primaryProfilePin = new PrimaryProfilePin()

function primaryProfileKey() {
  return primaryProfilePin.resolve(readActiveDesktopProfile)
}

// Options describing the current connection setup for `resolveProfileBackendRoute`.
function profileRouteOptions(
  _profile: string | null | undefined,
  request?: { method?: string; path?: string }
): ProfileRouteOptions {
  // One hosted backend serves every profile; requests carry `?profile=`.
  return {
    globalRemote: true,
    primaryProfile: primaryProfileKey(),
    profileRemoteOverride: false,
    primaryRemoteActive: true,
    ownEntry: false,
    isolatedBackend: false,
    requestMethod: request?.method,
    requestPath: request?.path
  }
}

// Resolve a backend connection for the given profile, per the routing table in
// resolveProfileBackendRoute(). An empty / unknown profile resolves to the
// primary, so legacy callers are unchanged.
async function ensureBackend(
  profile: string | null | undefined,
  opts: {
    passive?: boolean
    request?: { method?: string; path?: string }
    spawnPriority?: LocalBackendSpawnPriority
  } = {}
): Promise<Awaited<ReturnType<typeof backendConnectionState.getPromise>>> {
  const key = profile && String(profile).trim() ? String(profile).trim() : primaryProfileKey()

  profileDeletionGate.assertCanStart(key)

  const route = resolveProfileBackendRoute(key, profileRouteOptions(key, opts.request))
  const connection = await startScout()

  // The hosted backend serves every profile; the descriptor still carries the
  // profile so renderer WebSocket, filesystem and cache routing target it.
  return route.descriptorProfile
    ? { ...connection, profile: route.descriptorProfile, sharedPrimary: true }
    : { ...connection, profile: key }
}

// ── Registry-scoped backends (multi-connection, PR 2 of the campaign) ──────
// Resolve a backend for (connectionId, profile) against the v2 registry.
// The LOCAL connection routes through ensureBackend() when the v1 route is
// itself local (so every single-source path stays byte-identical), and forces
// a genuinely-local child when the v1 mode says remote; non-local connections
// pool under the composite key from backendScopeKey() and reuse the same pool
// entry lifecycle (LRU, idle reaper, touch) as per-profile local backends.
async function ensureRegistryBackend(
  _connectionId,
  profile,
  _managedUpdateCorrelation = '',
  opts: { passive?: boolean; spawnPriority?: LocalBackendSpawnPriority } = {}
) {
  // Every registry id names the one hosted backend.
  return ensureBackend(profile, opts)
}

const backendShutdown = createBackendShutdownCoordinator(async (): Promise<void> => {
  await waitForTeardown([teardownPrimaryBackendAndWait(backendTeardownOptions('quit'))], 7_000)
})

const quitTeardown = createQuitTeardownCoordinator(() => app.quit())

const quitFinalization = createQuitFinalization({
  isWindows: IS_WINDOWS,
  hardExit: code => {
    rememberLog(`[quit] forcing Windows process exit after Electron quit finalization stalled`)
    app.exit(code)
  }
})

async function exitAfterBackendShutdown(code) {
  try {
    await backendShutdown.run()
  } catch {
    // Already logged by backendShutdown; the exit must still happen.
  }

  app.exit(code)
}

// Returns the profile name whose backend was torn down, or null when the
// request is not a profile-delete.  The caller uses this to skip ensureBackend
// for the just-torn-down profile — otherwise ensureBackend respawns a pool
// backend whose ensure_scout_home() recreates the deleted profile directory.
//
// The routing *decision* (which branch fires, what profile name gets
// returned) lives in the pure decideProfileDeleteAction() in
// profile-delete-routing.ts; this function only performs the side effects
// that decision calls for.
async function prepareProfileDeleteRequest(request) {
  const profile = profileNameFromDeleteRequest(request)

  const decision = decideProfileDeleteAction(profile, {
    isDefaultProfile: p => p === 'default',
    isValidProfileName: p => PROFILE_NAME_RE.test(p),
    primaryProfileKey
  })

  if (decision.action === 'noop') {
    return null
  }

  if (decision.action === 'teardown-primary') {
    writeActiveDesktopProfile('default')
    await teardownPrimaryBackendAndWait()
  }

  return decision.profile
}

async function prepareProfileRenameRequest(request) {
  return prepareProfileRenameLifecycle(request, {
    isValidProfileName: profile => PROFILE_NAME_RE.test(profile),
    primaryProfileKey,
    reloadPrimaryWindow: () => {
      mainWindow?.reload()
    },
    restartPrimaryBackend: async () => {
      await startScout()
    },
    teardownPoolBackendAndWait: async () => undefined,
    teardownPrimaryBackendAndWait,
    writeActiveDesktopProfile: profile => {
      writeActiveDesktopProfile(profile)
    }
  })
}

function startScout({ supervisorRecovery = false }: { supervisorRecovery?: boolean } = {}): Promise<
  Awaited<ReturnType<typeof backendConnectionState.getPromise>>
> {
  return runScoutStart({ supervisorRecovery })
}

// A quit or update handoff kills renderers while their windows can still report
// live; the renderer lifecycle must treat that as teardown, not a crash to reload.
function rendererTeardownInProgress(): boolean {
  return isQuittingForHandoff || backendShutdown.hasStarted()
}

/**
 * The terminal boot failure currently latched in this process, if any. These
 * latches are cleared only by an explicit recovery path (reset, repair,
 * apply-config, confirmed sign-in, or the child 'exit' handler), never by a
 * retry, so both the per-request short-circuit in runScoutStart and the
 * supervisor's respawn refusal must consult the same trio in the same order.
 */
function latchedBootFailure(): Error | null {
  return bootstrapFailure ?? backendStartFailure ?? remoteReauthFailure ?? null
}

async function runScoutStart({ supervisorRecovery = false }: { supervisorRecovery?: boolean } = {}): Promise<
  Awaited<ReturnType<typeof backendConnectionState.getPromise>>
> {
  void supervisorRecovery

  if (!isPrimaryInstance) {
    rememberLog('[boot] non-primary instance: skipping backend machinery')
    throw new Error('Scout Desktop is already running in another window.')
  }

  // A confirmed reauth rejection stays latched until the user retries; this
  // runs on every proxied request, so it stays silent.
  const latched = latchedBootFailure()

  if (latched) {
    throw latched
  }

  // E2E: simulate a boot failure without breaking the real backend.
  if (BOOT_FAKE_ERROR) {
    await advanceBootProgress('backend.resolve', 'Resolving Scout backend', 8)
    const error = new Error(BOOT_FAKE_ERROR) as any
    error.isBootstrapFailure = true
    bootstrapFailure = error
    throw error
  }

  const existingConnectionPromise = backendConnectionState.getPromise()

  if (existingConnectionPromise) {
    return existingConnectionPromise
  }

  migrateActiveProfileIfMissing()

  const connectionAttempt = backendConnectionState.startAttempt()
  // One launch-profile decision per attempt (#108417): a profile remembered
  // mid-startup becomes the NEXT boot's preference.
  const { routingProfile: primaryProfile } = resolveLaunchProfile(readActiveDesktopProfile)

  primaryProfilePin.pin(primaryProfile)
  setActiveGatewayProfile(primaryProfile)

  const connectionPromise = (async () => {
    await advanceBootProgress('backend.resolve', 'Resolving Scout backend', 8)
    const remote = await resolveRemoteBackend(primaryProfile, { primary: true })
    // The resolve can outlive this attempt; a late success must not publish.
    backendConnectionState.assertCurrentAttempt(connectionAttempt)
    setWslBridgeProfileState(primaryProfile, false)

    await advanceBootProgress('backend.remote', `Connecting to the Scout backend at ${remote.baseUrl}`, 24)
    await waitForRemoteScout(remote)
    backendConnectionState.assertCurrentAttempt(connectionAttempt)

    updateBootProgress({
      phase: 'backend.ready',
      message: 'Scout backend is ready',
      progress: 94,
      running: true,
      error: null
    })

    return createPrimaryRemoteConnection(remote, scoutLog.slice(-80), getWindowState())
  })().catch(async error => {
    if (!backendConnectionState.clearPromiseForAttempt(connectionAttempt)) {
      throw error
    }

    // Release this attempt's routing identity so a later start re-reads the
    // preference (#108417).
    primaryProfilePin.clear()

    const message = error instanceof Error ? error.message : String(error)

    const statusCode = Number(
      error && typeof error === 'object' && Number.isInteger((error as any).statusCode)
        ? (error as any).statusCode
        : NaN
    )

    // A confirmed reauth rejection can't self-heal; everything else (backend
    // down, network blip across sleep) is transient and stays retryable.
    const isReauth = isReauthRequiredError(error)

    if (isReauth) {
      remoteReauthFailure = error instanceof Error ? error : new Error(message)
    }

    updateBootProgress(
      {
        error: message,
        message: `Desktop boot failed: ${message}`,
        phase: 'backend.error',
        retryable: !isReauth,
        running: false,
        statusCode: Number.isInteger(statusCode) ? statusCode : undefined
      },
      { allowDecrease: true }
    )
    throw error
  })

  backendConnectionState.setPromise(connectionAttempt, connectionPromise)

  return connectionPromise
}

// Shared navigation guards + window chrome wiring applied to every window
// (the primary plus any secondary session windows). Factored out of
// createWindow() so secondary windows can't drift from the main window's
// security posture: external links open in the OS browser, in-app navigation
// stays confined to the dev server / packaged file URL, and the preview /
// devtools / zoom / context-menu affordances behave identically everywhere.
//
// `zoom` is opt-out for the pet overlay: it sizes its own OS window to fit the
// sprite in unzoomed CSS px (overlayWindowSize -> setBounds) and has its own
// Alt+wheel scale, so inheriting the global UI zoom would render the mascot
// larger than its window and crop it. Chat windows keep zoom on.
function wireCommonWindowHandlers(win, { zoom = true }: { zoom?: boolean } = {}) {
  installPreviewShortcut(win)
  installDevToolsShortcut(win)
  installBrowserNavGestures(win)

  // Claim Ctrl/Cmd+F in the main process — on Pop!_OS / GNOME-based Linux
  // distros the Ctrl+F keydown does not reach the renderer's `view.findInPage`
  // binding (#81727). Routing it through `before-input-event` forwards the
  // intent at the earliest observable point. macOS / Windows keep the
  // renderer's own rebindable keybind, so the hook is Linux-only: installing
  // it elsewhere would make Ctrl/Cmd+F un-rebindable and double-open.
  if (process.platform === 'linux') {
    installFindShortcut(win)
  }

  if (zoom) {
    installZoomShortcuts(win)
    // Re-apply persisted zoom on show/restore/resize/cross-display move
    // (Chromium can drop webContents zoom after these window transitions), on
    // EVERY full load — not once, since crash recovery reloads and would
    // outlive a spent `once` listener (#46429) — and after in-page navigation,
    // where Chromium applies the target hash route's own per-URL zoom record
    // (see installZoomReassertOnNavigation; #48658, #38854, #79863).
    const reassertZoom = () => restorePersistedZoomLevel(win)

    installZoomReassertOnWindowEvents(win, reassertZoom)
    installZoomReassertOnNavigation(win.webContents, reassertZoom)
  }

  installContextMenuBridge(win)
  // Always deny, never open as a side effect: GHSA-9f4c-93c8-jc8g. Trusted
  // links arrive via `scout:openExternal`, not here. See window-open-policy.ts.
  win.webContents.setWindowOpenHandler(
    createWindowOpenHandler(origin => rememberLog(`[window-open] denied: ${origin}`))
  )
  win.webContents.on('will-navigate', (event, url) => {
    if ((DEV_SERVER && url.startsWith(DEV_SERVER)) || (!DEV_SERVER && url.startsWith('file:'))) {
      return
    }

    event.preventDefault()
    void openExternalUrl(url)
  })
}

/**
 * Give the preview pane's `<webview>` guests a preload — and ONLY those
 * guests. The pane's webview is the one `webview` tag in the app and it
 * always carries the `persist:scout-preview` partition, so the partition is
 * the ownership key: any future webview that does not opt into that partition
 * inherits nothing from this mechanism.
 *
 * The preload (preview-guest-preload-entry.ts) never opens anything itself.
 * It forwards a clicked `_blank` anchor to the host renderer via
 * `sendToHost`, and the pane admits the scheme and routes the URL through the
 * audited `scout:openExternal` channel. Popup requests themselves stay
 * denied-by-omission: the webview has no `allowpopups`, and the
 * `setWindowOpenHandler` contract (GHSA-9f4c-93c8-jc8g) stays side-effect
 * free.
 */
function installPreviewGuestPreload() {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'window') {
      return
    }

    contents.on('will-attach-webview', (_attachEvent, webPreferences, params) => {
      if (params.partition !== 'persist:scout-preview') {
        return
      }

      webPreferences.preload = PREVIEW_GUEST_PRELOAD_PATH
    })
  })
}

// Every window we open starts with `show: false` so the renderer's first themed
// paint lands before it appears, and `ready-to-show` is what reveals it.
// Electron 40 can drop that event entirely (electron/electron#51972) on
// Linux/Wayland, remote displays and VMs, leaving the window hidden forever even
// though the renderer finished loading. Keep the themed path as the preferred
// reveal, then fall back a few seconds after the renderer loads. `show` and
// `onRevealed` carry the caller's reveal action and post-visible work; whichever
// path wins runs them exactly once. Callers that pass `onRevealFailed` also get
// the pre-paint failure branch (see window-reveal.ts).

// Secondary "session windows" — one extra OS window per chat so a user can
// work with multiple chats side by side. The registry guarantees one window
// per sessionId (re-opening focuses the existing window) and self-cleans on
// close. The primary mainWindow is never tracked here. Pure logic + the URL
// builder live in session-windows.ts so they stay unit-testable.
const sessionWindows = createSessionWindowRegistry()

const minimizeToTray = createMinimizeToTray({
  preferencesPath: path.join(app.getPath('userData'), 'minimize-to-tray.json'),
  getIconPath: getAppIconPath,
  restoreMainWindow: () => ensureMainWindow(mainWindow, { isReady: app.isReady(), createWindow, focusWindow }),
  isQuittingForHandoff: () => isQuittingForHandoff,
  log: rememberLog
})

function focusWindow(win) {
  if (!win || win.isDestroyed()) {
    return
  }

  if (win.isMinimized()) {
    win.restore()
  }

  if (!win.isVisible()) {
    win.show()
  }

  win.focus()
}

function spawnSecondaryWindow({
  connectionId,
  sessionId,
  profile,
  watch
}: { connectionId?: null | string; sessionId?: string; profile?: null | string; watch?: boolean } = {}) {
  const icon = getAppIconPath()

  const win = new BrowserWindow({
    width: SESSION_WINDOW_MIN_WIDTH,
    height: SESSION_WINDOW_MIN_HEIGHT,
    minWidth: SESSION_WINDOW_MIN_WIDTH,
    minHeight: SESSION_WINDOW_MIN_HEIGHT,
    title: 'Scout',
    titleBarStyle: 'hidden',
    titleBarOverlay: getTitleBarOverlayOptions(),
    trafficLightPosition: IS_MAC ? WINDOW_BUTTON_POSITION : undefined,
    ...chatWindowSurfaceOptions(),
    icon,
    // Don't show until the renderer's first themed paint is ready. macOS
    // `vibrancy` ignores `backgroundColor` and paints a translucent OS
    // material (which follows the OS appearance, not the app theme), so a
    // dark-themed app on a light-mode Mac flashes white until the renderer
    // covers it. ready-to-show fires after the boot-time paint in
    // themes/context.tsx, so the window appears already themed.
    show: false,
    webPreferences: chatWindowWebPreferences(PRELOAD_PATH)
  })

  // Chat-surface registration: applyWindowTranslucency swaps this window's
  // backing between opaque-themed and alpha-0 when glass toggles.
  minimizeToTray.registerWindow(win)
  translucencyBackedWindows.add(win)

  if (IS_MAC) {
    win.setWindowButtonPosition?.(WINDOW_BUTTON_POSITION)
  }

  wireWindowReveal(win)

  bindWindowChromeEvents(win, sendWindowStateChanged)

  streamThrottle.register(win)
  wireCommonWindowHandlers(win, zoomWiringForWindowKind('chat'))
  attachRendererConsoleCapture(win, 'session-window', rememberLog)
  // The preload asks for its skin before it can publish its own active route.
  // Register the profile carried in the window URL before loading the renderer.
  recordWindowConnectionRoute(win.webContents, {
    connectionId: null,
    profile: localSkinProfileKey(profile ?? primaryProfileKey()),
    registryScoped: false
  })

  // Renderer lifecycle diagnostics + recovery (#81290): a dead session-window
  // renderer used to log nothing and stay black; now it logs with its window
  // kind and reloads under the shared crash-loop budget, exactly like the
  // primary window, without touching any other window.
  installWindowRendererLifecycle(win, {
    kind: 'secondary',
    callbacks: {
      log: rememberLog,
      reload: () => {
        win.webContents.reload()
      }
    },
    isIntentionalTeardown: rendererTeardownInProgress,
    reloadWindowMs: RENDERER_RELOAD_WINDOW_MS,
    reloadMax: RENDERER_RELOAD_MAX,
    recentReloadTimesRef: rendererReloadTimesRef
  })

  loadWindowUrl(
    win,
    buildSessionWindowUrl(sessionId, {
      connectionId,
      devServer: DEV_SERVER,
      profile,
      rendererIndexPath: DEV_SERVER ? undefined : resolveRendererIndex(),
      watch
    }),
    'Session window'
  )

  return win
}

// Open (or focus) a standalone window for a single chat session.
function createSessionWindow(sessionId, { connectionId = null, profile = null, watch = false } = {}) {
  return sessionWindows.openOrFocus(sessionId, () => spawnSecondaryWindow({ connectionId, sessionId, profile, watch }))
}

// Popped-out in-app Browser: same webview + address bar as a docked Browser
// tab, in its own OS window. One window per tab id (re-open focuses); closing
// it tells the other renderers so they can dock the tab again.
const browserWindows = createSessionWindowRegistry()

function notifyBrowserPopoutClosed(tabId) {
  if (typeof tabId !== 'string' || !tabId) {
    return
  }

  for (const other of BrowserWindow.getAllWindows()) {
    if (!other.isDestroyed()) {
      other.webContents.send('scout:browser-popout:closed', tabId)
    }
  }
}

function spawnBrowserWindow(tabId) {
  const icon = getAppIconPath()

  const win = new BrowserWindow({
    width: BROWSER_WINDOW_WIDTH,
    height: BROWSER_WINDOW_HEIGHT,
    minWidth: BROWSER_WINDOW_MIN_WIDTH,
    minHeight: BROWSER_WINDOW_MIN_HEIGHT,
    title: 'Scout',
    titleBarStyle: 'hidden',
    titleBarOverlay: getTitleBarOverlayOptions(),
    trafficLightPosition: IS_MAC ? WINDOW_BUTTON_POSITION : undefined,
    ...chatWindowSurfaceOptions(),
    icon,
    show: false,
    webPreferences: chatWindowWebPreferences(PRELOAD_PATH)
  })

  translucencyBackedWindows.add(win)

  if (IS_MAC) {
    win.setWindowButtonPosition?.(WINDOW_BUTTON_POSITION)
  }

  wireWindowReveal(win)

  bindWindowChromeEvents(win, sendWindowStateChanged)

  streamThrottle.register(win)
  wireCommonWindowHandlers(win, zoomWiringForWindowKind('chat'))
  attachRendererConsoleCapture(win, 'browser-window', rememberLog)

  installWindowRendererLifecycle(win, {
    kind: 'browser',
    callbacks: {
      log: rememberLog,
      reload: () => {
        win.webContents.reload()
      }
    },
    isIntentionalTeardown: rendererTeardownInProgress,
    reloadWindowMs: RENDERER_RELOAD_WINDOW_MS,
    reloadMax: RENDERER_RELOAD_MAX,
    recentReloadTimesRef: rendererReloadTimesRef
  })

  minimizeToTray.registerWindow(win)
  win.on('closed', () => notifyBrowserPopoutClosed(tabId))

  loadWindowUrl(
    win,
    buildBrowserWindowUrl(tabId, {
      devServer: DEV_SERVER,
      rendererIndexPath: DEV_SERVER ? undefined : resolveRendererIndex()
    }),
    'Browser window'
  )

  return win
}

function createBrowserWindow(tabId) {
  return browserWindows.openOrFocus(tabId, () => spawnBrowserWindow(tabId))
}

// Additional full "instance" windows — peers of the primary that render the
// COMPLETE app (sidebar, routing, its own draft) against the shared backend, so
// a user can run multiple GUI windows at once (⌘⇧N / the "New Window" palette
// command). Unlike the compact session windows they carry no `?win` flag; a
// separate `peer=1` marker prevents them from replaying app-launch source
// restoration after joining that shared backend. The primary mainWindow stays
// the notification / deep-link / pet-overlay anchor and
// is NOT tracked here. The set holds a strong reference so an open peer isn't
// garbage-collected, and drops it on close.
const instanceWindows = new Set<any>()

// Cascade a new instance off whichever window spawned it so it doesn't land
// exactly on top of its source. Falls back to the persisted primary geometry
// when there's no live source window (e.g. all windows closed on macOS). The
// pure cascade math lives in session-windows.ts (instanceWindowBounds).
function nextInstanceBounds(source: BrowserWindow | null = BrowserWindow.getFocusedWindow() || mainWindow) {
  const displays = screen.getAllDisplays()

  const fallback = computeWindowOptions(
    readWindowState() ?? firstLaunchSize(screen.getPrimaryDisplay().workArea),
    displays
  )

  const base = source && !source.isDestroyed() ? source.getBounds() : null

  return instanceWindowBounds(base, fallback, displays)
}

// Open a new full-chrome instance window. Mirrors createWindow()'s window
// options (shared chatWindowWebPreferences + streamThrottle registration so a
// streamed answer never stalls in the background) but is a peer, not the
// primary: it never overwrites mainWindow or re-homes the source. Its renderer
// joins the requested pooled backend through its own connection/profile route.
function createInstanceWindow(
  options?: DesktopProfileRoute,
  source: BrowserWindow | null = BrowserWindow.getFocusedWindow() || mainWindow
) {
  const route = resolveDesktopWindowLaunch(
    options,
    source && !source.isDestroyed() ? windowConnectionRoutes.get(source.webContents.id) : null,
    { connectionId: null, profile: primaryProfileKey() }
  )

  validateDesktopProfileRoute(route)
  const icon = getAppIconPath()

  const win = new BrowserWindow({
    ...nextInstanceBounds(source),
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    title: 'Scout',
    titleBarStyle: 'hidden',
    titleBarOverlay: getTitleBarOverlayOptions(),
    trafficLightPosition: IS_MAC ? WINDOW_BUTTON_POSITION : undefined,
    ...chatWindowSurfaceOptions(),
    icon,
    show: false,
    webPreferences: chatWindowWebPreferences(PRELOAD_PATH)
  })

  instanceWindows.add(win)
  minimizeToTray.registerWindow(win)
  recordWindowConnectionRoute(win.webContents, { ...route, registryScoped: route.connectionId !== null })

  // Chat-surface registration: see applyWindowTranslucency.
  translucencyBackedWindows.add(win)

  if (IS_MAC) {
    win.setWindowButtonPosition?.(WINDOW_BUTTON_POSITION)
  }

  wireWindowReveal(win)

  bindWindowChromeEvents(win, sendWindowStateChanged)

  streamThrottle.register(win)
  wireCommonWindowHandlers(win, zoomWiringForWindowKind('chat'))

  // Renderer lifecycle diagnostics + recovery (#81290), same policy as the
  // primary and session windows: a crashed instance renderer logs with its
  // window kind and reloads under the shared crash-loop budget.
  installWindowRendererLifecycle(win, {
    kind: 'instance',
    callbacks: {
      log: rememberLog,
      reload: () => {
        win.webContents.reload()
      }
    },
    isIntentionalTeardown: rendererTeardownInProgress,
    reloadWindowMs: RENDERER_RELOAD_WINDOW_MS,
    reloadMax: RENDERER_RELOAD_MAX,
    recentReloadTimesRef: rendererReloadTimesRef
  })

  win.on('closed', () => {
    instanceWindows.delete(win)
  })

  attachRendererConsoleCapture(win, 'instance', rememberLog)
  loadWindowUrl(
    win,
    buildInstanceWindowUrl({
      ...route,
      devServer: DEV_SERVER,
      rendererIndexPath: DEV_SERVER ? undefined : resolveRendererIndex()
    }),
    'Instance window'
  )

  return win
}

registerChatOnboardingWindow({ enabled: GUEST_ONBOARDING, mainWindow: (): BrowserWindow | null => mainWindow })
registerMachineProfile()

// The pet overlay: a single transparent, frameless, always-on-top window that
// hosts ONLY the floating mascot. Shift-clicking the in-window pet "pops it out"
// here so it can leave the app's bounds and stay visible while Scout is
// minimized (Codex-style task-completion glance). It carries no gateway
// connection of its own — the main renderer is the single source of truth and
// pushes pet state over IPC (scout:pet-overlay:state); the overlay just renders
// it. Control flows back (pop-in, composer submit) via scout:pet-overlay:control.
let petOverlayWindow = null
// Set while a close is in flight: Electron's close() is async and can be
// aborted on macOS, so the window may still be alive after closePetOverlay().
// openPetOverlay must never reuse (or leave) a closing window — otherwise two
// overlays can coexist and the orphaned one, rendering nothing, becomes an
// invisible mouse-enabled transparent region that eats desktop clicks.
let petOverlayClosing = false

function petOverlayUrl() {
  if (DEV_SERVER) {
    return `${DEV_SERVER.endsWith('/') ? DEV_SERVER.slice(0, -1) : DEV_SERVER}/?win=overlay#/`
  }

  return `${pathToFileURL(resolveRendererIndex()).toString()}?win=overlay#/`
}

function spawnPetOverlayWindow(bounds) {
  const win = new BrowserWindow({
    width: Math.max(80, Math.round(bounds?.width || 220)),
    height: Math.max(80, Math.round(bounds?.height || 220)),
    x: Number.isFinite(bounds?.x) ? Math.round(bounds.x) : undefined,
    y: Number.isFinite(bounds?.y) ? Math.round(bounds.y) : undefined,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Windows/Linux need this so the helper window does not get its own
    // taskbar/alt-tab entry. On macOS, cmd-tab is app-level and this can make
    // the whole app look like it vanished when the only newly-created visible
    // window is a frameless overlay. Use NSPanel + Mission Control hiding below
    // instead, leaving the main Scout app as the Dock/cmd-tab anchor.
    skipTaskbar: !IS_MAC,
    hasShadow: false,
    alwaysOnTop: true,
    // macOS panels are non-activating helper windows and can float over full
    // screen spaces without becoming the app's main switcher window.
    type: IS_MAC ? 'panel' : undefined,
    hiddenInMissionControl: IS_MAC,
    // Non-activating: the overlay must never become the app's key/main window,
    // or it (a frameless, taskbar-skipping panel) becomes the app's switcher
    // anchor and the Scout icon drops out of cmd/alt-tab — especially when the
    // main window is minimized. We flip this on only while the composer needs
    // the keyboard (see scout:pet-overlay:set-focusable).
    focusable: false,
    show: false,
    // Fully transparent — the renderer paints only the sprite + bubble.
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: true,
      // Keep the sprite animating + bubble updating while the main window is
      // minimized/blurred — the whole point of the overlay.
      backgroundThrottling: false
    }
  })

  // Float above other apps and follow the user across desktops so the pet is
  // always reachable. `floating` + `type: panel` is the macOS NSPanel path; the
  // more aggressive `screen-saver` level can interfere with normal app/window
  // switching semantics.
  win.setAlwaysOnTop(true, IS_MAC ? 'floating' : 'screen-saver')
  win.setHiddenInMissionControl?.(true)

  // The overlay is a transparent rectangle; only the sprite pixels should be
  // interactive. The renderer toggles click-through as the cursor enters/
  // leaves the sprite (scout:pet-overlay:ignore-mouse), but the window MUST
  // start click-through from the main process: if the overlay page is slow to
  // load, blank, or its renderer has died, a mouse-enabled transparent window
  // sits over the desktop eating clicks (the invisible "dead zone" bug). The
  // wake indicator already uses this spawn-time ignore pattern. forward:true
  // keeps mousemove flowing to the page so the renderer can re-arm
  // interactivity the moment the cursor touches a solid sprite pixel. Linux
  // has no forward, so there the overlay stays a solid window instead.
  if (petOverlayClickThrough()) {
    win.setIgnoreMouseEvents(true, { forward: true })
  }

  try {
    // Electron docs: macOS may transform process type on each
    // setVisibleOnAllWorkspaces() call unless skipTransformProcessType=true,
    // which briefly hides the Dock/cmd-tab presence. Keep Scout in the normal
    // ForegroundApplication class so shift-clicking the pet never drops the app
    // out of app switchers.
    win.setVisibleOnAllWorkspaces(
      true,
      IS_MAC ? { visibleOnFullScreen: true, skipTransformProcessType: true } : undefined
    )
  } catch {
    // Not supported everywhere — best effort.
  }

  // Pet overlay opts out of global UI zoom (see zoomWiringForWindowKind): it
  // owns its window-fit + scale, and inheriting zoom would crop the sprite.
  wireCommonWindowHandlers(win, zoomWiringForWindowKind('petOverlay'))

  wireWindowReveal(win, { show: () => win.showInactive() })

  // Log-only renderer lifecycle (#81290): a dead overlay must never resurrect
  // itself over the app, but its loss belongs in desktop.log.
  installWindowRendererLifecycle(win, { kind: 'overlay', callbacks: { log: rememberLog } })

  win.on('closed', () => {
    // A stale window openPetOverlay replaced must not touch its replacement.
    if (petOverlayWindow !== win) {
      return
    }

    petOverlayWindow = null
    petOverlayClosing = false

    // If the overlay went away on its own (e.g. ⌘W), tell the main renderer to
    // pop the pet back in so it doesn't stay hidden. Harmless echo when we're
    // the ones who closed it (popInPet already cleared the active flag).
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scout:pet-overlay:control', { type: 'pop-in' })
    }
  })

  attachRendererConsoleCapture(win, 'pet-overlay', rememberLog)
  loadWindowUrl(win, petOverlayUrl(), 'Pet overlay')

  return win
}

function openPetOverlay(bounds) {
  if (petOverlayWindow && !petOverlayWindow.isDestroyed() && !petOverlayClosing) {
    if (bounds) {
      petOverlayWindow.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(80, Math.round(bounds.width)),
        height: Math.max(80, Math.round(bounds.height))
      })
    }

    petOverlayWindow.showInactive()

    return petOverlayWindow
  }

  // A previous close was requested but never finished (close() can be aborted
  // on macOS) — force the stale window down before spawning a replacement so
  // two overlays can never coexist. Detach it first so its 'closed' handler
  // (sync or not) can't pop the pet back in over the replacement.
  if (petOverlayWindow && !petOverlayWindow.isDestroyed()) {
    const stale = petOverlayWindow
    petOverlayWindow = null
    stale.destroy()
  }

  petOverlayClosing = false
  petOverlayWindow = spawnPetOverlayWindow(bounds)

  return petOverlayWindow
}

function closePetOverlay() {
  if (petOverlayWindow && !petOverlayWindow.isDestroyed()) {
    petOverlayClosing = true
    petOverlayWindow.close()
  }

  // The 'closed' handler nulls petOverlayWindow and clears the flag — do NOT
  // null here: an open() racing a slow/aborted close would otherwise spawn a
  // second overlay while the first is still on screen (see petOverlayClosing).
}

// Re-home the popped-out pet after a display change: an overlay that still
// fits its display stays put, one pushed past a work-area edge is clamped back
// in, and one on no display is re-centered on the main window's display (see
// resolvePetOverlayBounds). The corrected spot is pushed
// back to the renderer via the existing 'bounds' control channel, which it
// persists for the next pop-out/restart.
function rehomePetOverlay() {
  if (!petOverlayWindow || petOverlayWindow.isDestroyed() || petOverlayClosing) {
    return
  }

  const current = petOverlayWindow.getBounds()
  const resolved = placePetOverlay(current, mainWindow)

  if (!resolved) {
    return
  }

  if (
    resolved.x === current.x &&
    resolved.y === current.y &&
    resolved.width === current.width &&
    resolved.height === current.height
  ) {
    return
  }

  petOverlayWindow.setBounds(resolved)

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scout:pet-overlay:control', { type: 'bounds', bounds: resolved })
  }
}

// ── HUD mode ────────────────────────────────────────────────────────────────
//
// The chrome-free floating chat: a transparent, frameless, always-on-top
// window showing only the composer and its scrollback, so Scout can be driven
// while the user works in another app.
//
// Unlike the pet overlay / quick entry, this is a FULL app renderer with its
// own gateway — the same thing createInstanceWindow() spawns, reshaped. That
// is deliberate: the HUD renders the real chat surface, so its composer is the
// app's composer (slash commands, attachments, queue, voice) instead of a
// lookalike that drifts. Entering HUD mode hides the main window; leaving
// restores it.
let hudWindow: BrowserWindow | null = null
// A closing HUD is no longer the active one, but its shortcut still belongs
// to HUD until Electron actually destroys that window.
const hudWindows = new WeakSet<BrowserWindow>()

// Whether closing the HUD should bring the main window back. Armed whenever a
// live main window exists at HUD-open time, visible or not: the HUD hides the
// app window itself, so a main window minimized or behind another app when
// the HUD opened still needs a surface back — arming only on `isVisible()`
// left the user with NO Scout window after the second toggle (#88513).
let hudRestoreMainWindow = false

// The session the HUD is currently on, reported by its renderer whenever the
// selection changes. Leaving HUD mode is a HANDOFF, not just a window close:
// the gateway binds a session's event stream to exactly one socket, so the
// turn the HUD started is streaming to the HUD's socket and the app window
// hears nothing. The app has to re-resume that session to take the stream
// back, and it can only do that if it knows which session to ask for — the
// HUD may have switched sessions, or started a new one the app has never
// seen. Main is the only party that outlives the HUD's renderer, so it holds
// the id and hands it over in the close broadcast.
let hudSessionId = null

// The profile the live HUD renderer booted against (rides hudUrl's query
// string). A renderer adopts its backend once at boot, so a retarget onto a
// session from a DIFFERENT profile cannot be a same-window `goto` — the HUD
// must be respawned against the new profile's backend (see openHudWindow).
let hudProfile = null

// A wide, short bar parked near the bottom of the active display — the shape
// of a game chat frame, and where one belongs. Defaults only: once the user
// moves or resizes the HUD, hud-state.json wins (same pattern as the main
// window's window-state.json).
const HUD_STATE_PATH = path.join(app.getPath('userData'), 'hud-state.json')

function readHudState() {
  try {
    const raw = JSON.parse(fs.readFileSync(HUD_STATE_PATH, 'utf8'))

    if (
      [raw?.x, raw?.y, raw?.width, raw?.height].every(v => Number.isFinite(v)) &&
      raw.width >= 380 &&
      raw.height >= 160
    ) {
      return raw
    }
  } catch {
    // First run / unreadable — fall through to defaults.
  }

  return null
}

function persistHudState() {
  if (!hudWindow || hudWindow.isDestroyed()) {
    return
  }

  try {
    const { x, y, width, height } = hudWindow.getNormalBounds()
    fs.mkdirSync(path.dirname(HUD_STATE_PATH), { recursive: true })
    writeFileAtomic(HUD_STATE_PATH, JSON.stringify({ x, y, width, height }, null, 2))
  } catch (err) {
    rememberLog(`[hud-state] persist failed: ${err?.message || err}`)
  }
}

function resetHudWindowLayout(): boolean {
  if (!hudWindow || hudWindow.isDestroyed()) {
    return false
  }

  const win = hudWindow
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const bounds = defaultHudBounds(display?.workArea)

  if (!applyHudResetBounds(win, bounds)) {
    rememberLog('[hud-state] reset layout failed while applying native bounds')

    return false
  }

  persistHudState()

  return true
}

const schedulePersistHudState = debounce(persistHudState, 250)

// How often Linux gets told where the cursor is. Fast enough that the bar is
// solid before a click lands after the pointer arrives, cheap enough to leave
// running for as long as the HUD is open — it is one `getCursorScreenPoint()`
// and, when the answer has not changed, nothing else.
const HUD_CURSOR_POLL_MS = 60

// Snap-to-pointer — global ⌘⇧G while the HUD is open (tap, not hold).
const HUD_SNAP_ANCHOR_Y = 48

function hudWindowing() {
  return resolveHudWindowing(process.platform, process.env, process.argv)
}

function applyHudSnapToPointer() {
  if (!hudWindow || hudWindow.isDestroyed() || !hudWindowing().clientPlacement) {
    return
  }

  const cursor = screen.getCursorScreenPoint()
  const bounds = hudWindow.getBounds()
  const display = screen.getDisplayNearestPoint(cursor)
  const workArea = display?.workArea ?? bounds
  const anchor = { x: Math.round(bounds.width / 2), y: HUD_SNAP_ANCHOR_Y }

  const origin = snapHudBounds(
    cursor,
    anchor,
    { width: bounds.width, height: bounds.height },
    hudWindow.webContents.getZoomFactor(),
    workArea
  )

  // setBounds — NOT setPosition alone: on Windows, a transparent frameless
  // window silently grows ~1px per setPosition call (see move-by handler).
  // On native Wayland the compositor ignores the position half; the snap
  // shortcut is therefore a documented no-op there.
  hudWindow.setBounds({
    x: origin.x,
    y: origin.y,
    width: bounds.width,
    height: bounds.height
  })
}

const hudSnapShortcut = createHudSnapShortcut(globalShortcut, applyHudSnapToPointer)

function registerHudSnapShortcut() {
  if (!hudSnapShortcut.register()) {
    rememberLog('[hud] snap shortcut unavailable — CommandOrControl+Shift+G may be owned by another app')
  }
}

/**
 * Feed the HUD renderer the cursor position on Linux.
 *
 * Everywhere else the renderer learns this from mousemove, which keeps arriving
 * while the window ignores the mouse because we pass `{ forward: true }`. That
 * option is macOS/Windows only. Without it a Linux HUD stops hearing the
 * pointer the moment it turns click-through, so it can never notice the pointer
 * coming back and stays transparent — the bar is there, and clicking it hits
 * whatever is behind. Main can still see the cursor, so it says so.
 *
 * Deliberately the same decision, just a different source for one input: the
 * renderer runs its usual hit test on the point it is handed. Re-deciding
 * anything here would put a second, drifting copy of the click-through rules in
 * the main process.
 */
function startHudCursorFeed(win: BrowserWindow) {
  const windowing = hudWindowing()

  if (!windowing.cursorFeed) {
    if (!windowing.ignoreMouse) {
      try {
        win.setIgnoreMouseEvents(false)
      } catch {
        // best effort
      }
    }

    return
  }

  let last: string | null = null

  const timer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) {
      return
    }

    const point = cursorPointInWindow(screen.getCursorScreenPoint(), win.getBounds(), win.webContents.getZoomFactor())

    // Off-window is a real answer (it is what hands the mouse back), so it is
    // sent — once. Only an unchanged answer is dropped, to keep an idle cursor
    // from waking the renderer 16 times a second.
    const key = point ? `${Math.round(point.x)},${Math.round(point.y)}` : 'out'

    if (key === last) {
      return
    }

    last = key
    win.webContents.send('scout:hud:cursor', point)
  }, HUD_CURSOR_POLL_MS)

  win.on('closed', () => clearInterval(timer))
}

/**
 * Watch for a fullscreen app under the HUD (the Discord-style game overlay
 * cue) and feed the answer to its renderer. Pure detection lives in
 * hud-game-overlay.ts; enumeration is the same front-to-back walk the
 * read_window_below tool uses. The renderer answers with the low-opacity
 * treatment (`data-hud-game`), so main stays out of the styling business.
 */
function startHudGameOverlayFeed(win: BrowserWindow) {
  const titlesAvailable = IS_MAC ? systemPreferences.getMediaAccessStatus?.('screen') === 'granted' : true

  let last = { active: false, app: '' }

  const push = (state: { active: boolean; app: string }) => {
    if (!win.isDestroyed()) {
      win.webContents.send('scout:hud:game-overlay', state)
    }
  }

  // Replay the latest state to every load of this window. The watch pushes only
  // on CHANGE and its first tick fires the moment the window is created — well
  // before the renderer has mounted its listener — so a HUD opened over a game
  // that is already fullscreen would hear the one and only message before it
  // could receive it, then sit at "no game" forever while main was certain it
  // had reported one. (Same reason quick entry caches its last state push.)
  // did-finish-load also covers HMR full reloads during development.
  win.webContents.on('did-finish-load', () => push(last))

  // The watch gives up after two failed enumerations and never says so, which
  // is how a HUD that cannot see the screen at all — no game cue, and
  // read_window_below failing beside it — leaves nothing in the log to explain
  // itself. Report the reason once; the null keeps the watch's contract.
  let reported = false

  const enumerate = async () => {
    const windows = await enumerateWindowsFrontToBack(process.pid, titlesAvailable)

    if (!enumerationFailed(windows)) {
      return windows
    }

    if (!reported) {
      reported = true
      console.warn(`[scout] HUD cannot enumerate windows: ${windows.reason}`)
    }

    return null
  }

  const dispose = startHudGameOverlayWatch({
    enumerate,
    displayBounds: () => screen.getDisplayMatching(win.getBounds()).bounds,
    selfPid: process.pid,
    send: state => {
      last = state
      push(state)
    }
  })

  win.on('closed', dispose)
}

function hudBounds() {
  // Remembered spot first — validated against the LIVE displays so a HUD
  // parked on an unplugged monitor comes back on-screen instead of lost.
  const saved = readHudState()

  if (saved) {
    const onScreen = screen.getAllDisplays().some(d => {
      const a = d.workArea

      return (
        saved.x < a.x + a.width - 40 &&
        saved.x + saved.width > a.x + 40 &&
        saved.y < a.y + a.height - 40 &&
        saved.y + saved.height > a.y + 40
      )
    })

    if (onScreen) {
      return saved
    }
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display?.workArea

  return defaultHudBounds(area)
}

function hudUrl(sessionId, profile) {
  // The profile rides the query string next to `win=hud` (BEFORE the '#', so
  // HashRouter never sees it). The HUD renderer's gateway boot reads it and
  // adopts that backend instead of the primary — without it, a HUD opened on a
  // non-primary profile's conversation resolves the session id against the
  // wrong backend and falls back to the default profile's last session.
  return buildHudWindowUrl(sessionId, {
    devServer: DEV_SERVER,
    profile,
    rendererIndexPath: DEV_SERVER ? undefined : resolveRendererIndex()
  })
}

// Tell every window whether the HUD is up, so a toggle in any of them reads
// the truth even when the HUD is closed from its own side (⌘W / its exit row).
// Carries the HUD's session so the app window can re-home onto it on the way
// out (see hudSessionId).
function broadcastHudState(open) {
  const payload = { open, sessionId: hudSessionId }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('scout:hud:changed', payload)
    }
  }
}

function spawnHudWindow(sessionId, profile) {
  const win = new BrowserWindow({
    ...hudBounds(),
    minWidth: 380,
    minHeight: 160,
    title: HUD_WINDOW_TITLE,
    frame: false,
    transparent: true,
    // NOT resizable. A transparent frameless window on Windows keeps a
    // system-level edge resize hot-zone while `resizable` is on — the OS
    // interprets pointer capture near the edge as a resize gesture, so the
    // window grows a few px every drag (worse at >100% DPI scaling). The
    // composer drag calls setPosition, which must move the window, not resize
    // it. Resizing is done by the renderer's edge/corner handles through
    // `scout:hud:set-bounds`, which flips resizable on for the call — the
    // same pattern the pet overlay uses for its wheel-scale.
    resizable: false,
    // macOS AppKit's constrainFrameRect clamps setBounds to the current
    // display unless this is on. The HUD is moved by renderer-driven
    // setBounds (not a native titlebar drag), so without it the bar cannot
    // be dragged onto another monitor. No-op on Windows/Linux.
    enableLargerThanScreen: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Keep the interactive macOS HUD as an ordinary NSWindow. NSPanel defaults
    // hidesOnDeactivate to true, which removes the HUD while the user works in
    // another app; the floating/all-spaces setup below supplies overlay behavior.
    skipTaskbar: !IS_MAC,
    hasShadow: false,
    alwaysOnTop: true,
    // Clips the vibrancy layer to the HUD's silhouette rather than a hard
    // rectangle — the frost stops where the window's corners do.
    roundedCorners: true,
    // Vibrancy must keep rendering while the window is BLURRED: streaming under
    // another app is the whole feature, and the default 'followWindow' kills
    // the frost the moment something else takes focus.
    visualEffectState: 'active',
    hiddenInMissionControl: IS_MAC,
    show: false,
    backgroundColor: '#00000000',
    // The full chat webPreferences — this window streams a real transcript, so
    // it needs everything a chat window needs (preload bridge, autoplay for
    // voice, the shared throttling contract).
    webPreferences: chatWindowWebPreferences(PRELOAD_PATH)
  })

  applyHudElectronOverlay(win, process.platform)
  win.setHiddenInMissionControl?.(true)

  // Linux intentionally starts on ONE virtual desktop. During a renderer
  // grab, scout:hud:workspace-transfer temporarily makes the X11 window
  // sticky; releasing it assigns the HUD to KDE's then-current desktop.

  // Streaming into a window that is ALWAYS blurred (the user is in another
  // app) is the entire feature, so it gets the same stream-aware unthrottling
  // every chat window does.
  streamThrottle.register(win)
  hudWindows.add(win)
  wireCommonWindowHandlers(win, zoomWiringForWindowKind('chat'))

  // Remember where the user parks and sizes it (debounced — these fire many
  // times mid-drag).
  bindGeometryPersistence(win, schedulePersistHudState)

  startHudCursorFeed(win)
  startHudGameOverlayFeed(win)

  wireWindowReveal(win, {
    show: () => {
      win.show()
      win.focus()
    },
    onRevealed: () => {
      // Step the app aside: the HUD IS the surface now.
      if (hudRestoreMainWindow && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide()
      }

      // Compositor overlay adapters (Hyprland float+pin today). Electron
      // alwaysOnTop is already set; this is the dialect some WMs actually hear.
      void promoteHudOverlay({ title: HUD_WINDOW_TITLE })
    },
    // #108230: the HUD is born `show: false` + transparent, and its renderer
    // lifecycle is deliberately log-only (#81290 — a dead renderer should be
    // diagnosable, not resurrected). But a load failure or renderer crash
    // BEFORE first paint leaves a hidden window every toggle claims is open.
    // Tear it down instead: requestHudClose is bounded, and the 'closed'
    // handler below owns the one teardown path (snap shortcut, main-window
    // restore, broadcastHudState(false)) so the toggles converge to closed.
    onRevealFailed: reason => {
      rememberLog(`[renderer:hud] window never revealed; tearing it down (${reason})`)
      destroyHudWindow(win)
    }
  })

  win.on('closed', () => {
    if (hudWindow === win) {
      hudWindow = null
    } else if (hudWindow && !hudWindow.isDestroyed()) {
      // Superseded by a profile respawn: the replacement owns the shortcut,
      // the main-window restore and the toggles. Nothing to hand back.
      return
    }

    // Whether the close came from closeHudWindow() or from the window's own
    // side (a crashed renderer, a native close), this is the one teardown:
    // release the global snap shortcut, put the app back so the user is never
    // left with no surface, and correct every window's toggle.
    hudSnapShortcut.dispose()
    restoreMainWindowFromHud()
    broadcastHudState(false)
  })

  attachRendererConsoleCapture(win, 'hud', rememberLog)
  // Log-only lifecycle (#81290): the HUD is a compact auxiliary surface the
  // user can re-toggle; a dead renderer should be diagnosable, not resurrected.
  installWindowRendererLifecycle(win, { kind: 'hud', callbacks: { log: rememberLog } })
  // Same timing as a session window: the profile query is known now, while the
  // renderer cannot announce its route until after preload has already run.
  recordWindowConnectionRoute(win.webContents, {
    connectionId: null,
    profile: localSkinProfileKey(profile ?? primaryProfileKey()),
    registryScoped: false
  })
  loadWindowUrl(win, hudUrl(sessionId, profile), 'HUD')

  return win
}

// Put the app window back, and give it the keyboard. `focusWindow`, not a bare
// `show()`: show() alone leaves a minimized window minimized, and on macOS a
// shown-but-not-key window means the user is looking at the app with the
// caret still belonging to whatever the HUD was floating over.
function restoreMainWindowFromHud() {
  if (!hudRestoreMainWindow) {
    return
  }

  hudRestoreMainWindow = false
  focusWindow(mainWindow)
}

// Take the HUD window down. The 'closed' handler stays attached so ONE path
// owns the teardown (snap shortcut, main-window restore, close broadcast)
// whether the window went via the exit button, ⌘W, a profile respawn, or the
// grace deadline — detaching it before close() was how a renderer that never
// answered the close left an always-on-top HUD nobody could dismiss and no
// broadcast to correct the toggles.
function destroyHudWindow(win: BrowserWindow) {
  if (hudWindow === win) {
    hudWindow = null
  }

  requestHudClose(win)
}

function openHudWindow(sessionId, profile) {
  const profileKey = typeof profile === 'string' && profile.trim() ? profile.trim() : null

  if (hudWindow && !hudWindow.isDestroyed()) {
    // Pointed at another PROFILE: the live renderer is bound to the old
    // profile's backend, and a renderer adopts its backend exactly once at
    // boot — an in-place goto would resolve the id against the wrong backend
    // (the #82285 fallback). Respawn against the right one. The old window's
    // 'closed' handler sees `hudWindow` already pointing at the replacement,
    // so it neither restores main nor broadcasts a false "closed".
    if (profileKey && hudProfile !== profileKey) {
      const previous = hudWindow

      hudSessionId = sessionId || null
      hudProfile = profileKey
      hudWindow = spawnHudWindow(sessionId, profileKey)
      previous.destroy()
      broadcastHudState(true)
      registerHudSnapShortcut()

      return hudWindow
    }

    // Already up, but pointed somewhere else — switch it rather than just
    // raising it. Asking for HUD mode from another tab means "put THIS
    // conversation in the HUD", and a plain focus leaves the wrong one there.
    if (sessionId && sessionId !== hudSessionId) {
      hudSessionId = sessionId
      hudWindow.webContents.send('scout:hud:goto', sessionId)
      // Keep every window's idea of where the HUD is pointed in step, so the
      // toggle keeps reading "switch" vs "dismiss" correctly.
      broadcastHudState(true)
    }

    focusWindow(hudWindow)

    return hudWindow
  }

  hudRestoreMainWindow = Boolean(mainWindow && !mainWindow.isDestroyed())
  hudSessionId = sessionId || null
  hudProfile = profileKey
  hudWindow = spawnHudWindow(sessionId, profileKey)
  broadcastHudState(true)
  registerHudSnapShortcut()

  return hudWindow
}

function closeHudWindow() {
  const win = hudWindow

  if (win && !win.isDestroyed()) {
    destroyHudWindow(win)

    return
  }

  // No live HUD (a renderer that died, a toggle racing the close): still
  // release what an open HUD holds, so the toggles read right.
  hudWindow = null
  hudSnapShortcut.dispose()
  restoreMainWindowFromHud()
  broadcastHudState(false)
}

// ── Quick Entry ─────────────────────────────────────────────────────────────
//
// A global shortcut summons a small frameless always-on-top composer from
// anywhere, so a prompt can be fired without raising the whole app. The window
// carries NO gateway connection: it hands its text to us, we forward it to the
// PRIMARY renderer, and that renderer submits through the same prompt path the
// normal composer uses (see store/quick-entry + hooks/use-quick-entry-bridge).
//
// Main owns the OS registration and the persisted preference (it must restore
// the shortcut on a cold launch without the renderer ever visiting Settings),
// same authority split as keep-awake. Registration failure is surfaced, never
// swallowed: a chord another app already owns comes back as `error: 'taken'`.
const QUICK_ENTRY_CONFIG_PATH = path.join(app.getPath('userData'), 'quick-entry.json')

let quickEntryWindow = null

// Latest state push from the primary renderer (connection + recent sessions),
// replayed to a quick window that spawns after the push happened.
let quickEntryLastState = null

function readQuickEntrySettings() {
  try {
    return sanitizeQuickEntrySettings(JSON.parse(fs.readFileSync(QUICK_ENTRY_CONFIG_PATH, 'utf8')))
  } catch {
    // Missing / unreadable / malformed → shipped defaults (enabled, default chord).
    return sanitizeQuickEntrySettings(undefined)
  }
}

function writeQuickEntrySettings(settings) {
  try {
    fs.mkdirSync(path.dirname(QUICK_ENTRY_CONFIG_PATH), { recursive: true })
    fs.writeFileSync(QUICK_ENTRY_CONFIG_PATH, JSON.stringify(settings, null, 2), 'utf8')
  } catch (error) {
    rememberLog(`[quick-entry] write failed: ${error.message}`)
  }
}

function quickEntryUrl() {
  if (DEV_SERVER) {
    return `${DEV_SERVER.endsWith('/') ? DEV_SERVER.slice(0, -1) : DEV_SERVER}/?win=quick#/`
  }

  return `${pathToFileURL(resolveRendererIndex()).toString()}?win=quick#/`
}

function spawnQuickEntryWindow() {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const bounds = quickEntryWindowBounds(display?.workArea)

  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Same rationale as the pet overlay: on Windows/Linux keep the helper out
    // of the taskbar/alt-tab list; on macOS use an NSPanel so the frameless
    // capture window never becomes the app's cmd-tab anchor.
    skipTaskbar: !IS_MAC,
    // macOS derives a transparent window's native shadow from its alpha
    // content, but the boot HTML paints an OPAQUE background before the
    // renderer forces transparency (quick-entry-root.tsx) — the OS then
    // caches a full-frame shadow that renders as a stray detached blur blob
    // behind the card (#99172). The card draws its own CSS box-shadow, so the
    // native one only double-paints; the other transparent overlays (pet,
    // HUD) already run shadowless. Other platforms keep it.
    hasShadow: !IS_MAC,
    alwaysOnTop: true,
    type: IS_MAC ? 'panel' : undefined,
    hiddenInMissionControl: IS_MAC,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: true
    }
  })

  win.setAlwaysOnTop(true, IS_MAC ? 'floating' : 'screen-saver')
  win.setHiddenInMissionControl?.(true)

  try {
    win.setVisibleOnAllWorkspaces(
      true,
      IS_MAC ? { visibleOnFullScreen: true, skipTransformProcessType: true } : undefined
    )
  } catch {
    // Not supported everywhere — best effort.
  }

  // Opts out of global UI zoom for the same reason as the pet overlay: it sizes
  // its own OS window and a zoomed composer would overflow it.
  wireCommonWindowHandlers(win, zoomWiringForWindowKind('quickEntry'))

  // Log-only renderer lifecycle (#81290): a dead quick-entry window must never
  // resurrect itself over the app, but its loss belongs in desktop.log.
  installWindowRendererLifecycle(win, { kind: 'quick', callbacks: { log: rememberLog } })

  // Hide on blur. The window must never hold the user's focus captive — losing
  // focus is the cheapest, least surprising dismiss (matches Spotlight).
  win.on('blur', () => {
    if (!win.isDestroyed()) {
      win.hide()
    }
  })

  win.on('closed', () => {
    if (quickEntryWindow === win) {
      quickEntryWindow = null
    }
  })

  // Replay the last known gateway state as soon as the page can hear it — a
  // freshly spawned quick window must not sit "disconnected" when the primary
  // renderer already reported a live gateway.
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed() && quickEntryLastState) {
      win.webContents.send('scout:quick-entry:state', quickEntryLastState)
    }
  })

  attachRendererConsoleCapture(win, 'quick-entry', rememberLog)
  loadWindowUrl(win, quickEntryUrl(), 'Quick entry')

  return win
}

// Move the (already-open) window to the display the cursor is on, so the chord
// summons it where the user is looking rather than where they last were.
function repositionQuickEntryWindow(win) {
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    win.setBounds(quickEntryWindowBounds(display?.workArea))
  } catch (error) {
    rememberLog(`[quick-entry] reposition failed: ${error.message}`)
  }
}

function showQuickEntryWindow() {
  if (!quickEntryWindow || quickEntryWindow.isDestroyed()) {
    // Reveal the window this call created, not whatever `quickEntryWindow`
    // points at by the time the event lands.
    const win = spawnQuickEntryWindow()
    quickEntryWindow = win

    wireWindowReveal(win, {
      show: () => {
        win.show()
        win.focus()
      }
    })

    return
  }

  repositionQuickEntryWindow(quickEntryWindow)
  quickEntryWindow.show()
  quickEntryWindow.focus()
  // Re-summoned: tell the renderer to clear any stale draft and refocus.
  quickEntryWindow.webContents.send('scout:quick-entry:shown')
}

function hideQuickEntryWindow() {
  if (quickEntryWindow && !quickEntryWindow.isDestroyed()) {
    quickEntryWindow.hide()
  }
}

// The chord toggles: pressing it while the composer is up puts it away, so one
// gesture does exactly one thing in both directions.
function toggleQuickEntryWindow() {
  if (quickEntryWindow && !quickEntryWindow.isDestroyed() && quickEntryWindow.isVisible()) {
    hideQuickEntryWindow()

    return
  }

  showQuickEntryWindow()
}

const quickEntryShortcut = createQuickEntryShortcut(globalShortcut, toggleQuickEntryWindow)

function applyQuickEntrySettings(settings) {
  const state = quickEntryShortcut.apply(settings)

  if (!settings.enabled) {
    // Turning the feature off must not leave an orphan always-on-top window.
    if (quickEntryWindow && !quickEntryWindow.isDestroyed()) {
      quickEntryWindow.close()
    }

    quickEntryWindow = null
  }

  if (state.error === 'taken') {
    rememberLog(`[quick-entry] shortcut ${state.shortcut} is already taken by another application`)
  } else if (state.error === 'invalid') {
    rememberLog(`[quick-entry] shortcut ${state.shortcut} is not a valid accelerator`)
  }

  return { ...state, enabled: settings.enabled }
}

function closeQuickEntryWindow() {
  quickEntryShortcut.dispose()

  if (quickEntryWindow && !quickEntryWindow.isDestroyed()) {
    quickEntryWindow.close()
  }

  quickEntryWindow = null
}

function createWindow() {
  const icon = getAppIconPath()
  const savedWindowState = readWindowState()
  mainWindow = new BrowserWindow({
    ...computeWindowOptions(
      savedWindowState ?? firstLaunchSize(screen.getPrimaryDisplay().workArea),
      screen.getAllDisplays()
    ),
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    title: 'Scout',
    // Frameless title bar on every platform so the renderer can paint the
    // "hide sidebar" button (and other left-side titlebar tools) flush with
    // the top edge — matching the macOS layout where the traffic lights sit
    // inside the same band. On Windows/Linux, titleBarOverlay tells Electron
    // to paint native min/max/close in the top-right of the renderer; on
    // macOS it just reserves a content inset alongside the traffic lights.
    titleBarStyle: 'hidden',
    titleBarOverlay: getTitleBarOverlayOptions(),
    trafficLightPosition: IS_MAC ? WINDOW_BUTTON_POSITION : undefined,
    ...chatWindowSurfaceOptions(),
    icon,
    // Hidden until the first themed paint so macOS `vibrancy` (which ignores
    // `backgroundColor` and follows the OS appearance) can't flash a light
    // material before the renderer paints the app theme. See createSessionWindow.
    show: false,
    // Shared with the secondary session windows (chatWindowWebPreferences);
    // stream-aware throttling is applied per-window via streamThrottle so a
    // live answer keeps painting while the window is blurred or minimized,
    // without pinning visibilityState to 'visible' at idle. See
    // session-windows.ts and stream-throttle.ts.
    webPreferences: chatWindowWebPreferences(PRELOAD_PATH)
  })

  const createdMainWindow = mainWindow
  minimizeToTray.registerWindow(createdMainWindow, { closeToTray: true })
  const defaultRoute = desktopProfilePreferences.getDefault()

  if (defaultRoute) {
    recordWindowConnectionRoute(mainWindow.webContents, {
      ...defaultRoute,
      registryScoped: defaultRoute.connectionId !== null
    })
  }

  // Chat-surface registration: see applyWindowTranslucency.
  translucencyBackedWindows.add(mainWindow)

  if (IS_MAC) {
    mainWindow.setWindowButtonPosition?.(WINDOW_BUTTON_POSITION)

    // Packaged builds keep the bundle icon so macOS can style it (#73195).
    if (icon && shouldOverrideDockIcon({ platform: process.platform, isPackaged: app.isPackaged })) {
      // The window icon is full-bleed for Linux; the Dock wants the mac grid.
      app.dock?.setIcon(resolveAppIcon([path.join(APP_ROOT, 'assets', 'icon-mac.png')]) ?? icon)
    }
  }

  if (!IS_MAC) {
    if (!nativeThemeListenerInstalled) {
      nativeThemeListenerInstalled = true
      nativeTheme.on('updated', () => {
        for (const win of BrowserWindow.getAllWindows()) {
          applyTitleBarOverlay(win)
        }
      })
    }
  }

  if (savedWindowState?.isMaximized) {
    mainWindow.maximize()
  }

  const revealController = wireWindowReveal(createdMainWindow, {
    onRevealed: () => {
      // Persist geometry as soon as the window is visible so a crash before the
      // first clean resize/move/close still captures the restored bounds (#56726).
      schedulePersistWindowState()

      // #111906: the Linux launcher holds back its .desktop entry write until the
      // window is on screen (a STARTING gnome-shell app must not see its entry change).
      notifyLauncherWindowRevealed()

      // #38216: clear the mid-boot marker only after a window is actually usable.
      // Keep sticky `fallback` when we launched with --no-sandbox so the next
      // Start Menu click does not re-enter the GPU FATAL crash loop. The marker
      // records the app version so the next update re-probes the sandbox.
      if (IS_WINDOWS) {
        try {
          writeSandboxMarker(
            app.getPath('userData'),
            markerAfterSuccessfulBoot({
              fallbackActive: windowsSandboxFallbackSticky,
              reason: windowsSandboxFallbackReason,
              appVersion: app.getVersion()
            })
          )
        } catch (error) {
          rememberLog(`[sandbox] marker update after main-window reveal failed: ${error?.message || error}`)
        }

        try {
          writeGpuStackCookieMarker(
            app.getPath('userData'),
            markerAfterSuccessfulGpuStackCookieBoot({
              fallbackActive: windowsGpuStackCookieFallbackSticky,
              appVersion: app.getVersion()
            })
          )
        } catch (error) {
          rememberLog(`[gpu] stack-cookie marker update after main-window reveal failed: ${error?.message || error}`)
        }
      }
    }
  })

  // Under Playwright testing, instantly show the window: `ready-to-show`
  // doesn't fire in some testing envs, and the suite can't wait out the
  // production fallback.
  if (process.env.TEST_WORKER_INDEX !== undefined) {
    revealController.reveal()
  }

  bindWindowChromeEvents(mainWindow, sendWindowStateChanged)

  // Reopen where the user left off. close is the backstop, flushed
  // synchronously before the window is gone.
  bindGeometryPersistence(mainWindow, schedulePersistWindowState)
  mainWindow.on('maximize', schedulePersistWindowState)
  mainWindow.on('unmaximize', schedulePersistWindowState)
  mainWindow.on('close', () => schedulePersistWindowState.flush())

  // the closed wrapper remains truthy, so clear only the window this callback owns.
  mainWindow.on('closed', () => {
    closePetOverlay()

    if (mainWindow === createdMainWindow) {
      mainWindow = null
      // the replacement renderer must register before queued links can be delivered.
      _rendererReadyForDeepLink = false
    }
  })

  streamThrottle.register(mainWindow)
  wireCommonWindowHandlers(mainWindow, zoomWiringForWindowKind('chat'))

  // Per-window renderer lifecycle diagnostics + recovery (#81290). The reload
  // policy (crashed/oom/killed → bounded reload via the shared rolling budget, then
  // the #38216 Windows sandbox relaunch check on suppression) is the same
  // policy this window used before it moved into the shared helper, so a
  // crashed peer renderer now logs and recovers exactly like the primary one.
  const mainContentsId = mainWindow.webContents.id
  installWindowRendererLifecycle(mainWindow, {
    kind: 'main',
    callbacks: {
      log: rememberLog,
      reload: () => {
        mainWindow.webContents.reload()
      },
      onCrashLoopSuppressed: details => {
        // #108047: STATUS_STACK_BUFFER_OVERRUN crash loops get a one-shot GPU
        // disable relaunch. Checked BEFORE the sandbox path so 0xC0000409 never
        // piggybacks --no-sandbox. If GPU fallback cannot run, surface the
        // visible error page instead of leaving a blank window.
        const stackCookieCrashLoop = {
          reason: details?.reason,
          exitCode: details?.exitCode,
          alreadyGpuDisabled:
            Boolean(REMOTE_DISPLAY_REASON) ||
            windowsGpuStackCookieFallbackActive ||
            alreadyHasDisableGpu(process.argv, process.env),
          relaunchAttempted: windowsGpuStackCookieRelaunchAttempted,
          gpuOverrideOff: isScoutDesktopGpuOverrideOff(process.env)
        }

        if (shouldRelaunchForRendererStackCookieCrashLoop(stackCookieCrashLoop)) {
          windowsGpuStackCookieRelaunchAttempted = true
          windowsGpuStackCookieFallbackActive = true
          windowsGpuStackCookieFallbackSticky = true

          try {
            writeGpuStackCookieMarker(
              app.getPath('userData'),
              gpuStackCookieFallbackMarker('renderer-crash-loop', app.getVersion())
            )
          } catch {
            void 0
          }

          rememberLog(
            '[renderer] Windows stack-cookie crash loop (0xC0000409); relaunching once with GPU disabled (#108047)'
          )

          try {
            app.relaunch({ args: buildDisableGpuRelaunchArgs(process.argv.slice(1)) })
            void exitAfterBackendShutdown(0)
          } catch (err) {
            rememberLog(`[renderer] GPU-disable relaunch failed: ${err?.message || err}`)
          }

          return
        }

        if (shouldSurfaceErrorForRendererStackCookieCrashLoop(stackCookieCrashLoop)) {
          rememberLog(
            '[renderer] Windows stack-cookie crash loop (0xC0000409) with GPU fallback unavailable; surfacing error page (#108047)'
          )
          void loadRendererLoadErrorPage(mainWindow, {
            errorCode: details?.exitCode,
            errorDescription:
              'The desktop renderer crashed repeatedly (Windows STATUS_STACK_BUFFER_OVERRUN / 0xC0000409). GPU fallback could not recover the window.',
            repairHint: 'scout desktop --force-build',
            reloadUrl: DEV_SERVER || pathToFileURL(resolveRendererIndex()).toString()
          })

          return
        }

        // #38216 renderer flavor (same recovery as #56726, credit @Sahil-SS9):
        // a deterministic Windows renderer crash loop with the sandbox
        // breakpoint signature gets one --no-sandbox relaunch instead of a
        // dead window. Gated on the exit code so unrelated crash loops don't
        // silently drop the sandbox.
        if (
          !shouldRelaunchForRendererSandboxCrashLoop({
            reason: details?.reason,
            exitCode: details?.exitCode,
            alreadyNoSandbox: windowsSandboxFallbackActive || alreadyHasNoSandbox(process.argv, process.env),
            relaunchAttempted: windowsNoSandboxRelaunchAttempted
          })
        ) {
          return
        }

        windowsNoSandboxRelaunchAttempted = true
        windowsSandboxFallbackActive = true
        windowsSandboxFallbackSticky = true
        windowsSandboxFallbackReason = 'renderer-crash-loop'

        try {
          writeSandboxMarker(app.getPath('userData'), fallbackMarker('renderer-crash-loop', app.getVersion()))
        } catch {
          void 0
        }

        rememberLog('[renderer] Windows sandbox crash loop detected; relaunching once with --no-sandbox (#38216)')

        try {
          app.relaunch({ args: buildNoSandboxRelaunchArgs(process.argv.slice(1)) })
          void exitAfterBackendShutdown(0)
        } catch (err) {
          rememberLog(`[renderer] --no-sandbox relaunch failed: ${err?.message || err}`)
        }
      },
      // #95575: a renderer that repeatedly fails to load (torn bundle after
      // an update, file locked by AV, missing index.html) used to sit on a
      // white screen with only a desktop.log line. Once the bounded reload
      // budget is exhausted, put the VISIBLE error page in the window so the
      // user sees what is wrong and how to repair it.
      onFailedLoadBudgetExhausted: details => {
        rememberLog(
          `[renderer:main] load-failure budget exhausted; loading visible error page` +
            `${details?.errorCode === undefined ? '' : ` code=${String(details.errorCode)}`}`
        )
        void loadRendererLoadErrorPage(mainWindow, {
          errorCode: details?.errorCode,
          url: details?.url,
          errorDescription: 'The desktop renderer failed to load repeatedly after the update.',
          repairHint: 'scout desktop --force-build',
          reloadUrl: DEV_SERVER || pathToFileURL(resolveRendererIndex()).toString()
        })
      },
      // #116472: the OS/Chromium can kill a renderer while the window is live (memory
      // reclaim, an external SIGTERM/SIGKILL). The lifecycle reloads that under the shared
      // budget (#85048); once the budget is spent, or for an unrecoverable reason, surface
      // the reason + a recovery button instead of a silent dead window.
      onRendererTerminated: details => {
        // An intentional quit/handoff also tears the renderer down; never pop a
        // recovery page for it (its window may still be alive when this fires).
        if (isQuittingForHandoff || backendShutdown.hasStarted() || mainWindow.isDestroyed()) {
          return
        }

        const reason = details?.reason ? String(details.reason) : 'unknown'
        const exit = details?.exitCode === undefined ? '' : `, exit code ${String(details.exitCode)}`
        rememberLog(`[renderer:main] renderer terminated while live (reason=${reason}${exit}); surfacing recovery page`)
        void loadRendererLoadErrorPage(mainWindow, {
          title: 'Scout desktop UI was terminated',
          errorDescription:
            `The desktop UI process was terminated unexpectedly (reason: ${reason}${exit}). ` +
            'Your sessions and the background gateway are unaffected — reload to continue.',
          reloadUrl: DEV_SERVER || pathToFileURL(resolveRendererIndex()).toString()
        })
      }
    },
    isIntentionalTeardown: rendererTeardownInProgress,
    reloadWindowMs: RENDERER_RELOAD_WINDOW_MS,
    reloadMax: RENDERER_RELOAD_MAX,
    recentReloadTimesRef: rendererReloadTimesRef,
    reloadOnFailedLoad: true
  })

  // Electron always passes the event first. The canonical (Electron 36+) shape
  // is (event, messageDetails); the deprecated positional shape is
  // (event, level, message, line, sourceId). Handled in renderer-log.ts, which
  // every renderer-content window shares (#79428: crashes in secondary/HUD/
  // quick-entry windows used to vanish without a trace).
  attachRendererConsoleCapture(mainWindow, 'main', rememberLog)

  // #95575: a torn renderer bundle (update replaced the app while its files
  // were locked) loads fine and then dies on the first lazy import — a white
  // screen with no error surface. resolveRendererIndex already logs the torn
  // copies; here we refuse to load one into the PRIMARY window and put the
  // visible repair page in it instead. The Reload button re-attempts the
  // bundle in case the file lock cleared since boot.
  const resolvedRenderer = DEV_SERVER ? null : resolveRendererIndexWithMissing()
  const rendererIndex = resolvedRenderer?.index ?? null
  const tornAssets = resolvedRenderer?.missing ?? []

  if (!DEV_SERVER && rendererIndex && tornAssets.length > 0) {
    rememberLog(
      `[renderer] primary window: chosen renderer bundle ${rendererIndex} is incomplete ` +
        `(${tornAssets.length} missing asset(s)); loading visible repair page instead of a white screen`
    )
    void loadRendererLoadErrorPage(mainWindow, {
      errorCode: 'ERR_FILE_NOT_FOUND',
      errorDescription: `The desktop renderer bundle is incomplete after the last update (${tornAssets.length} missing file(s)).`,
      missingAssets: tornAssets,
      repairHint: 'scout desktop --force-build',
      reloadUrl: pathToFileURL(rendererIndex).toString()
    })
  } else {
    loadWindowUrl(
      mainWindow,
      DEV_SERVER || pathToFileURL(rendererIndex || resolveRendererIndex()).toString(),
      'Renderer'
    )
  }

  // Start the Python backend NOW, in parallel with the renderer load — not on
  // did-finish-load. The backend cold boot (spawn → port announce → /api/status)
  // is the dominant startup cost, and serializing it behind Chromium's load
  // added the whole renderer load time to first-usable-composer. The promise is
  // shared (backendConnectionState), so the renderer's getConnection() joins
  // this in-flight boot instead of duplicating it; early boot-progress events
  // the renderer misses are recovered by its getBootProgress() pull on mount.
  const startup = defaultRoute ? connectDesktopProfileRoute(defaultRoute) : startScout()
  startup.catch(error => rememberLog(error.stack || error.message))

  mainWindow.webContents.once('did-finish-load', () => {
    // Zoom restore is handled by wireCommonWindowHandlers (shared with session
    // windows); no need to reapply it here.
    broadcastBootProgress()
    sendWindowStateChanged()
  })
}

ipcMain.handle('scout:connection', async (event, profile, extra) => {
  const route = resolveDesktopConnectionRequest(
    profile,
    windowConnectionRoutes.get(event.sender.id),
    primaryProfileKey()
  )

  return connectDesktopProfileRoute(route, spawnPriorityFrom(extra?.priority), event.sender)
})

async function connectDesktopProfileRoute(
  route: DesktopProfileRoute,
  spawnPriority: LocalBackendSpawnPriority = 'foreground',
  sender?: Electron.WebContents
) {
  // Coalesce concurrent renderer dials for one profile scope (#90812): the
  // renderer-side reconnect lock is per-window, so two windows waking at once
  // both land here. The claim key mirrors ensureBackend()'s own profile
  // normalization so every spelling of the primary coalesces onto one dial.
  const scopeKey = backendScopeKey(route.connectionId, route.profile)

  const connection = await backendDialClaims.run(scopeKey, () => ensureBackend(route.profile, { spawnPriority }))

  // Every republish carries LIVE window state (#102451): the backend pool entry
  // (and the getWindowState() snapshot startScout baked into it) outlives
  // reloads, reconnects and sleep/wake, so a reply built only from the cached
  // descriptor overwrites the renderer's live fullscreen flag with the
  // mint-time snapshot. Reading the caller's state HERE keeps registry-scoped,
  // primary-resolved and bare replies consistent with the
  // scout:window-state-changed live-push path.
  const windowState = liveWindowState(sender, {
    fromWebContents: BrowserWindow.fromWebContents,
    getWindowState,
    fallback: mainWindow
  })

  if (route.connectionId) {
    return overlayWindowState({ ...connection, connectionId: route.connectionId, registryScoped: true }, windowState)
  }

  const connectionId = resolvedConnectionId(readDesktopConnectionsRegistry(), connection)

  return connectionId
    ? overlayWindowState({ ...connection, connectionId }, windowState)
    : overlayWindowState(connection, windowState)
}

// Registry-scoped variant: resolve a backend for (connectionId, profile).
// An empty connection id is not registry.primary — that substitution dials
// another SSH host when a scoped caller drops the id. 'local' and an explicit
// primary id still resolve to those sources. The local kind delegates to
// ensureBackend when the v1 route is local, and forces a genuinely-local
// child when the v1 global mode is remote (the registry 'local' entry always
// means this machine) unless the profile is remote-only.
ipcMain.handle('scout:connection:for', async (event, payload) => {
  const { connectionId, profile, priority } = payload && typeof payload === 'object' ? (payload as any) : ({} as any)
  const registry = readDesktopConnectionsRegistry()
  const id = registryDialConnectionId(connectionId, registry.primary)
  const spawnPriority = spawnPriorityFrom(priority)

  return connectDesktopProfileRoute(
    { connectionId: id, profile: String(profile ?? '').trim() || 'default' },
    spawnPriority,
    event.sender
  )
})

const windowConnectionRoutes = new WindowConnectionRouteRegistry()
const windowConnectionRouteOwners = new Set<number>()

function recordWindowConnectionRoute(sender: Electron.WebContents, route: unknown) {
  const id = sender.id
  const previous = windowConnectionRoutes.get(id)
  const next = windowConnectionRoutes.set(id, route)

  if (
    previous?.connectionId !== next?.connectionId ||
    previous?.profile !== next?.profile ||
    previous?.registryScoped !== next?.registryScoped
  ) {
    void resetPreviewReach(id)
  }

  if (!windowConnectionRouteOwners.has(id)) {
    windowConnectionRouteOwners.add(id)
    sender.once('destroyed', () => {
      windowConnectionRoutes.delete(id)
      windowConnectionRouteOwners.delete(id)
      void resetPreviewReach(id)
    })
  }
}

ipcMain.on('scout:connection:active-route', (event, route) => recordWindowConnectionRoute(event.sender, route))
// Reconnect-after-wake recovery. The hosted backend has no child process whose
// exit would clear a dead connection, so before the renderer's backoff loop
// reconnects it asks us to confirm the cached connection is still reachable;
// if not, we drop the cache so the next getConnection() rebuilds it.
ipcMain.handle('scout:connection:revalidate', async () => {
  const connectionPromise = backendConnectionState.getPromise()

  if (!connectionPromise) {
    return { ok: true, rebuilt: false }
  }

  // Main and every session pop-out have their own renderer reconnect loop but
  // share this primary connection. Coalesce simultaneous requests so one outage
  // produces one failure observation rather than exhausting the whole streak.
  return remoteRevalidation.run(connectionPromise, async () => {
    return revalidateRemoteConnection({
      connectionPromise,
      currentConnectionPromise: () => backendConnectionState.getPromise(),
      log: rememberLog,
      probe: (connection, path, options) => fetchJsonForBackend(connection, path, options),
      resetConnection: () => resetScoutConnectionState({ soft: true }),
      tracker: remoteLiveness
    })
  })
})

ipcMain.handle('scout:gateway:ws-url', async (_event, profile) => {
  return gatewayWsUrlIpcResult(() => freshGatewayWsUrl(profile))
})
ipcMain.handle('scout:window:openSession', async (_event, sessionId, opts) => {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    return { ok: false, error: 'invalid-session-id' }
  }

  createSessionWindow(sessionId.trim(), {
    connectionId: typeof opts?.connectionId === 'string' ? opts.connectionId : null,
    profile: typeof opts?.profile === 'string' ? opts.profile : null,
    watch: opts?.watch === true
  })

  return { ok: true }
})
ipcMain.handle('scout:window:openInstance', async (event, options) => {
  createInstanceWindow(options, BrowserWindow.fromWebContents(event.sender))

  return { ok: true }
})
registerWindowControlIpc(ipcMain, sender => BrowserWindow.fromWebContents(sender))
ipcMain.handle('scout:window:openBrowser', async (_event, tabId) => {
  if (typeof tabId !== 'string' || !tabId.trim()) {
    return { ok: false, error: 'invalid-tab-id' }
  }

  createBrowserWindow(tabId.trim())

  return { ok: true }
})

// --- Text size (zoom) -------------------------------------------------------
// The settings UI drives the same clamped zoom scale as the Ctrl/Cmd
// shortcuts and the View menu. Reads and writes target the asking window.
ipcMain.handle('scout:zoom:get', event => {
  const window = BrowserWindow.fromWebContents(event.sender)

  const level = window && !window.isDestroyed() ? window.webContents.getZoomLevel() : DEFAULT_ZOOM_LEVEL

  return { level, percent: zoomLevelToPercent(level) }
})
ipcMain.on('scout:zoom:set-percent', (event, percent) => {
  const window = BrowserWindow.fromWebContents(event.sender)

  if (!window || window.isDestroyed()) {
    return
  }

  setAndPersistZoomLevel(window, percentToZoomLevel(Number(percent)))
})

// --- Pet overlay (pop-out mascot) — see pet-overlay-ipc.ts. ---------------
registerPetOverlayIpc({
  getMainWindow: () => mainWindow,
  getPetOverlayWindow: () => petOverlayWindow,
  openPetOverlay,
  closePetOverlay
})

// --- HUD mode (chrome-free floating chat) — see hud-ipc.ts. ---------------
const hudIpc = registerHudIpc({
  isMac: IS_MAC,
  getTranslucencyState: () => translucencyState,
  getHudWindow: () => hudWindow,
  openHudWindow,
  closeHudWindow,
  resetHudLayout: resetHudWindowLayout,
  setHudSessionId: value => {
    hudSessionId = value
  }
})

ipcMain.handle('scout:backend:recycle', async () => {
  // Models-page recovery after a code-skew 503 (#97046): drop the connection
  // and re-dial; the renderer shell stays mounted.
  await teardownPrimaryBackendAndWait({ soft: true })
  sendConnectionApplied()

  return { ok: true }
})
ipcMain.handle('scout:backend:retry', async () => {
  // Renderer's Retry: drop the current connection and any latched failure so
  // the next startScout() dials the hosted backend again.
  rememberLog('[boot] retry requested by renderer')
  await teardownPrimaryBackendAndWait()
  bootstrapFailure = null
  backendStartFailure = null
  remoteReauthFailure = null

  return { ok: true }
})
ipcMain.handle('scout:boot-progress:get', async () => bootProgressState)
ipcMain.handle('scout:plugin-profile-routes', async (_event, rawProfileNames) => {
  const fallbackProfileNames = Array.isArray(rawProfileNames)
    ? rawProfileNames
        .filter(name => typeof name === 'string')
        .map(name => name.trim())
        .filter(Boolean)
        .slice(0, 256)
    : []

  const registry = readDesktopConnectionsRegistry()
  const enumerations = await enumerateRegistryAgentSources(registry)
  let agents = buildAgentRoster(enumerations, { primaryConnectionId: registry.primary })

  // Roster enumeration deliberately does not dial connect-on-demand SSH
  // sources. Publish one credential-free seed route so a plugin can be the
  // first caller that opens the tunnel.
  const sshSeeds = undialedSshRouteSeeds(agents, registry.connections)

  if (sshSeeds.length > 0) {
    agents = [
      ...agents,
      ...sshSeeds.map(seed => {
        const source = registry.connections.find(connection => connection.id === seed.connectionId)!

        return {
          connectionId: source.id,
          connectionKind: source.kind,
          connectionLabel: source.label,
          handle: seed.profile,
          profile: seed.profile
        }
      })
    ]
  }

  // A local enumeration can fail while remote sources succeed. Preserve
  // cached v1 profile names as explicitly-local rows so those valid routes do
  // not disappear and duplicate names remain source-qualified.
  const localSource = registry.connections.find(source => source.kind === 'local')

  const localEnumeration = localSource
    ? enumerations.find(({ connection }) => connection.id === localSource.id)
    : undefined

  const localFallbackProfiles = localSource
    ? localRouteFallbackProfiles(
        agents,
        localSource.id,
        fallbackProfileNames,
        isLocalEnumerationFailure(localEnumeration?.error)
      )
    : []

  if (localSource && localFallbackProfiles.length > 0) {
    agents = [
      ...agents,
      ...localFallbackProfiles.map(profile => ({
        connectionId: localSource.id,
        connectionKind: localSource.kind,
        connectionLabel: localSource.label,
        handle: profile,
        profile
      }))
    ]
  }

  return buildRegistryProfileRoutes({ agents, sources: registry.connections })
})

// ── Opt-in keychain encryption for stored secrets ───────────────────────────
// get returns the current policy without touching safeStorage; set flips it
// and re-encodes every stored secret (see applySecretStorageEncryption).
ipcMain.handle('scout:secret-storage:get', async () => ({ on: secretStoragePolicy().on }))
ipcMain.handle('scout:secret-storage:set', async (_event: any, on: any) => applySecretStorageEncryption(on === true))

// ── v2 connection registry IPC (multi-source) ───────────────────────────────
// Storage-level CRUD for named agent sources. Routing/pooling consumption of
// the registry lands separately; these handlers only manage the persisted
// list, so they are safe to ship ahead of the switchover.
ipcMain.handle('scout:connections:list', async () => hostedConnectionsRegistry())

// Stable backend identity per registered connection: the `install_id` its
// /api/status reports (absent on backends older than the field). Enumeration
// runs on the ~5s Bot Mode roster poll and only hits /api/profiles, so the
// status probe is cached per connection with a TTL to avoid doubling roster
// traffic; the Test button refreshes it eagerly. A missing id simply bypasses
// the same-backend roster collapse — fully backward compatible.
const INSTALL_ID_TTL_MS = 5 * 60_000
const INSTALL_ID_NEGATIVE_TTL_MS = 60_000

function rememberConnectionInstallId(connectionId: string, statusBody: any) {
  const raw = statusBody && typeof statusBody === 'object' ? statusBody.install_id : undefined
  const id = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
  connectionInstallIds.set(connectionId, { id, ts: Date.now() })

  return id
}

async function probeConnectionInstallId(connectionId: string, descriptor: any): Promise<string | undefined> {
  const cached = connectionInstallIds.get(connectionId)

  if (cached && Date.now() - cached.ts < (cached.id ? INSTALL_ID_TTL_MS : INSTALL_ID_NEGATIVE_TTL_MS)) {
    return cached.id
  }

  try {
    const status: any = await getJsonForBackend(descriptor, '/api/status', { timeoutMs: 8_000 })

    return rememberConnectionInstallId(connectionId, status)
  } catch {
    // Keep any previously-known id (identity is stable; a transient fetch
    // failure must not flap the roster collapse), but do not cache a MISS
    // over it.
    if (cached?.id) {
      return cached.id
    }

    connectionInstallIds.set(connectionId, { id: undefined, ts: Date.now() })

    return undefined
  }
}

async function enumerateRegistryAgentSources(registry = readDesktopConnectionsRegistry()) {
  // One dead source must not wedge the whole roster: ensureRegistryBackend on
  // an unreachable remote can block up to the 45s readiness timeout, and the
  // Bot Mode poll runs every 5s — each poll queued behind the dead dial, so
  // the renderer painted stale rows for the entire outage (and the roster IPC
  // hung >30s in live repro). Bound each source's enumeration; a timeout is
  // reported like any other unreachable source and retried on the next poll.
  const withEnumerationDeadline = async <T>(work: Promise<T>, timeoutMs: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null

    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('roster enumeration timed out')), timeoutMs)
        })
      ])
    } finally {
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }

  return withoutInteractiveOauthLogin(() =>
    Promise.all(
      registry.connections.map(async connection => {
        let sourceFailureDetail = ''

        let raw: {
          connection: typeof connection
          error?: string
          needsSignIn?: boolean
          installId?: string
          profiles: null | string[]
          profileMetadata?: Record<string, RosterProfileMetadata>
        }

        try {
          {
            // Claim-guarded (#90812): this ~5s roster poll can race a renderer's
            // own reconnect dial for the same connection; coalescing avoids
            // bootstrapping a second SSH tunnel / remote dashboard.
            const descriptor: any = await withEnumerationDeadline(
              Promise.resolve(
                backendDialClaims.run(backendScopeKey(connection.id, null), () =>
                  ensureRegistryBackend(connection.id, null)
                )
              ),
              rosterSourceEnumerationTimeoutMs(connection)
            )

            const { body, installId } = await fetchRosterSourceData(
              () => getJsonForBackend(descriptor, '/api/profiles', { timeoutMs: 8_000 }),
              () => probeConnectionInstallId(connection.id, descriptor)
            )

            // The install-id probe is TTL-cached, so the 5s roster poll usually
            // pays zero extra requests; on a miss it runs beside /api/profiles.

            const profiles = Array.isArray(body?.profiles)
              ? body.profiles.map(p => String(p?.name || '').trim()).filter(Boolean)
              : []

            const profileMetadata = Array.isArray(body?.profiles)
              ? Object.fromEntries(
                  body.profiles
                    .map(profile => {
                      const name = String(profile?.name || '').trim()

                      if (!name) {
                        return null
                      }

                      const metadata: RosterProfileMetadata = {}

                      if (typeof profile?.display_name === 'string' && profile.display_name.trim()) {
                        metadata.display_name = profile.display_name.trim()
                      }

                      if (typeof profile?.title === 'string' && profile.title.trim()) {
                        metadata.title = profile.title.trim()
                      }

                      if (profile?.ui_meta && typeof profile.ui_meta === 'object') {
                        metadata.ui_meta = profile.ui_meta
                      }

                      if (typeof profile?.has_avatar === 'boolean') {
                        metadata.has_avatar = profile.has_avatar
                      }

                      return [name, metadata] as const
                    })
                    .filter((entry): entry is readonly [string, RosterProfileMetadata] => Boolean(entry))
                )
              : undefined

            // The root SCOUT_HOME is an agent too; enumerations that omit it
            // (older backends list only named profiles) still get a default row.
            if (!profiles.includes('default')) {
              profiles.unshift('default')
            }

            raw = {
              connection,
              profiles,
              ...(installId ? { installId } : {}),
              ...(profileMetadata ? { profileMetadata } : {})
            }
          }
        } catch (error: any) {
          sourceFailureDetail = [error?.statusCode, error?.cause?.message].filter(Boolean).join(' | ')
          raw = {
            connection,
            profiles: null,
            error: redactSecrets(String(error?.message || error)),
            needsSignIn:
              isReauthRequiredError(error) || (connection.authMode === 'oauth' && isGatewayAuthRejection(error))
          }
        }

        if (raw.error && raw.error !== 'connect-on-demand') {
          const diagnostic = redactSecrets([raw.error, sourceFailureDetail].filter(Boolean).join(' | '))
            .replace(/[\r\n]+/g, ' ')
            .slice(0, 800)

          if (rosterSourceErrors.get(connection.id) !== diagnostic) {
            rememberLog(`[fleet-roster] ${connection.id}: ${diagnostic}`)
            rosterSourceErrors.set(connection.id, diagnostic)
          }
        } else if (raw.profiles && rosterSourceErrors.delete(connection.id)) {
          rememberLog(`[fleet-roster] ${connection.id}: connection recovered`)
        }

        if (raw.profiles && raw.profiles.length > 0) {
          sshRosterCache.set(connection.id, raw.profiles)
        }

        const remembered = rememberSshEnumeration(raw, sshRosterCache.get(connection.id), connection.kind)

        return {
          connection,
          ...remembered,
          ...(raw.needsSignIn ? { needsSignIn: true } : {}),
          ...(raw.installId ? { installId: raw.installId } : {}),
          ...(raw.profileMetadata ? { profileMetadata: raw.profileMetadata } : {})
        }
      })
    )
  )
}

ipcMain.handle('scout:agents:roster', async () => {
  const registry = readDesktopConnectionsRegistry()
  const enumerations = await enumerateRegistryAgentSources(registry)

  return {
    agents: buildAgentRoster(enumerations, { primaryConnectionId: registry.primary }),
    // The active gateway owns the renderer's profiles.list — union agents
    // that report THIS connection are the same identities, not extra rows.
    // Expose the primary id so the plugin merger can annotate them in place
    // instead of appending duplicates (remote-only desktops doubled every
    // bot otherwise; see #88344).
    primaryConnectionId: registry.primary,
    sources: enumerations.map(({ connection, error, installId, profiles, needsSignIn }) => ({
      connectionId: connection.id,
      label: connection.label,
      kind: connection.kind,
      ...rosterSourceStatus({ profiles, error, needsSignIn }),
      ...(installId ? { installId } : {})
    }))
  }
})

// Registry-scoped fresh WS URL: the (connectionId, profile) analogue of
// scout:gateway:ws-url. Same single-use-ticket discipline for OAuth sources.
const registryGatewayWsUrlHandler = createRegistryGatewayWsUrlHandler({
  ensureBackend: ensureRegistryBackend,
  mintTicket: mintGatewayWsTicket,
  buildTicketUrl: buildGatewayWsUrlWithTicket,
  rememberHeaders: rememberRemoteWsHeaders
})

ipcMain.handle('scout:gateway:ws-url-for', async (_event, payload) => {
  return gatewayWsUrlIpcResult(() => registryGatewayWsUrlHandler(payload))
})

// GET twin of postJsonForBackend.
async function getJsonForBackend(descriptor, path, opts: any = {}) {
  return fetchJsonForBackend(descriptor, path, opts)
}

// Any-method REST call against a resolved backend descriptor — the descriptor
// analogue of the scout:api handler's own auth split: OAuth backends prefer a
// native bearer (cookieless RFC 8252 flow) and fall back to the OAuth cookie
// partition; token/local descriptors use the static session-token header.
async function fetchJsonForBackend(
  descriptor,
  path,
  opts: { method?: string; body?: unknown; upload?: unknown; timeoutMs?: number } = {}
) {
  const url = `${descriptor.baseUrl}${path}`

  if (descriptor.authMode === 'oauth') {
    // The OAuth cookie path rides electron.net with JSON headers; multipart
    // isn't wired there. Fail loudly rather than corrupting the upload.
    if (opts.upload) {
      throw new Error('File uploads are not supported against OAuth-gated remote backends yet.')
    }

    const options = {
      method: opts.method,
      body: opts.body,
      timeoutMs: opts.timeoutMs,
      headers: descriptor.headers
    }

    return requestWithOauthFallback(descriptor.baseUrl, {
      ensureNativeAccessToken,
      requestWithBearer: (bearer: string) => fetchJson(url, null, { ...options, bearer }),
      requestWithCookie: () => fetchJsonViaOauthSession(url, options)
    })
  }

  return fetchJson(url, descriptor.token, {
    method: opts.method,
    body: opts.body,
    upload: opts.upload,
    timeoutMs: opts.timeoutMs,
    headers: descriptor.headers
  })
}

ipcMain.handle('scout:profile:default:get', async () => desktopProfilePreferences.getDefault())
ipcMain.handle('scout:profile:default:set', async (_event, route) => desktopProfilePreferences.setDefault(route))
ipcMain.handle('scout:profile:get', async () => ({ profile: readActiveDesktopProfile() }))
// Persistence-only sibling of scout:profile:set: records the profile the
// Desktop last used WITHOUT tearing down the backend or reloading the window.
// An explicit default route wins at launch and is never replaced here.
ipcMain.handle('scout:profile:remember', async (_event, name) => ({
  profile: writeActiveDesktopProfile(name)
}))
ipcMain.handle('scout:profile:set', async (_event, name) => {
  const next = writeActiveDesktopProfile(name)

  // Switching profiles re-dials the hosted backend under the new profile.
  await teardownPrimaryBackendAndWait()
  mainWindow?.reload()

  return { profile: next }
})

ipcMain.on('scout:previewShortcutActive', (_event, active) => {
  previewShortcutActive = Boolean(active)
})

ipcMain.on('scout:f12ShortcutActive', (event, active) => {
  if (active) {
    f12ShortcutActiveWindows.add(event.sender.id)
  } else {
    f12ShortcutActiveWindows.delete(event.sender.id)
  }
})

app.on('web-contents-created', (_event, contents) => {
  contents.once('destroyed', () => f12ShortcutActiveWindows.delete(contents.id))
})

ipcMain.handle('scout:requestMicrophoneAccess', async () => {
  if (!IS_MAC || typeof systemPreferences.askForMediaAccess !== 'function') {
    return true
  }

  return systemPreferences.askForMediaAccess('microphone')
})

// read_window_below tool: which OS window is directly underneath this one.
// Metadata only (app, title, bounds) — never pixels. On macOS, other apps'
// window titles are gated behind the Screen Recording permission; pass titles
// through only when it is ALREADY granted, and never prompt for it here.
ipcMain.handle('scout:window:readBelow', async event => {
  const win = BrowserWindow.fromWebContents(event.sender)

  if (!win || win.isDestroyed()) {
    return null
  }

  const titlesAvailable = IS_MAC ? systemPreferences.getMediaAccessStatus?.('screen') === 'granted' : true

  const [x, y] = win.getPosition()
  const [width, height] = win.getSize()

  return readWindowBelow(process.pid, { x, y, width, height }, titlesAvailable)
})

async function dispatchRegistryApiRequest(
  request,
  registryConnectionId,
  routeProfile = request?.profile,
  requestProfile = request?.profile
) {
  // Claim-guarded (#90812): every registry-scoped REST call funnels through
  // here, so it can race a renderer's own WS reconnect dial for the same
  // (connectionId, profile) scope; coalescing avoids bootstrapping a second
  // SSH tunnel / remote dashboard. A passive read never dials, so it stays
  // OUT of the claim: an interactive open coalescing onto an in-flight
  // passive read would otherwise inherit its "no warm backend" rejection.
  const spawnPriority = spawnPriorityFrom(request?.priority)

  const connection: any = request?.passive
    ? await ensureRegistryBackend(registryConnectionId, routeProfile, '', { passive: true })
    : await backendDialClaims.run(backendScopeKey(registryConnectionId, routeProfile), () =>
        ensureRegistryBackend(registryConnectionId, routeProfile, '', { spawnPriority })
      )

  const requestPath = pathForRegistryBackendRequest(request.path, requestProfile, connection)

  const response = await fetchJsonForBackend(connection, requestPath, {
    method: request?.method,
    body: request?.body,
    upload: request?.upload,
    timeoutMs: resolveTimeoutMs(request?.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS)
  })

  desktopProfilePreferences.afterProfileRequest(registryConnectionId, request, response, connection.mode)

  return (request?.method || 'GET').toUpperCase() === 'GET'
    ? tagRegistrySessionResponse(requestPath, response, registryConnectionId)
    : response
}

function registryConnectionKind(connectionId) {
  const registry = readDesktopConnectionsRegistry()
  const source = registry.connections.find(connection => connection.id === connectionId)

  if (!source) {
    throw new Error(`No connection with id "${connectionId}".`)
  }

  return source.kind
}

async function handleScoutApiRequest(request) {
  // Registry-pinned request (request.connectionId): the renderer is working
  // against a REGISTERED gateway connection, so the data — cron jobs and their
  // run sessions included — lives in THAT host's state.db, not any local
  // profile's. Resolve the backend through the registry (same pool the job
  // list and WS traffic use) instead of the legacy profile route; a shared
  // remote host serves every profile via ?profile=, so scope the path.
  // An absent/empty id falls through to the byte-identical v1 route below.
  // Explicit `local` stays registry-pinned so it cannot inherit a v1 remote.
  const registryConnectionId = apiRequestRegistryConnectionId(request)

  if (registryConnectionId) {
    return dispatchRegistryApiRequest(request, registryConnectionId)
  }

  const profileRename = await prepareProfileRenameRequest(request)
  const tornDownProfile = await prepareProfileDeleteRequest(request)

  const profile = request?.profile
  const spawnPriority = spawnPriorityFrom(request?.priority)
  // After tearing down a backend for profile deletion, route to the primary
  // backend instead of spawning a fresh pool backend.  A freshly spawned
  // backend calls ensure_scout_home() which recreates the profile directory,
  // defeating the deletion and leaving a zombie process.
  //
  // Local-profile REST calls stay on the primary dashboard and carry ?profile=
  // (or name the profile in the path / PATCH body). A request that MUTATES
  // state the server cannot scope at all retains its pooled backend, whose
  // SCOUT_HOME is then the scope, so a destructive call can never fall
  // through to the primary home — `resolveProfileBackendRoute` case 6.
  //
  // A profile rename tears down the old-name backend the same way; for a
  // primary rename the lifecycle has already made `default` the temporary
  // primary until the PATCH settles, so the request routes there.
  const apiRoute = resolveProfileApiRequest(profile, request.path, profileRouteOptions(profile, request))

  const routeProfile = profileRename
    ? profileRename.routeProfile
    : resolveRouteProfile(tornDownProfile, apiRoute.backendProfile)

  let response
  let connection

  try {
    connection = await ensureBackend(routeProfile, {
      passive: request?.passive,
      request: { method: request?.method, path: request?.path },
      spawnPriority
    })
    const timeoutMs = resolveTimeoutMs(request?.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS)

    response = await fetchJsonForBackend(connection, apiRoute.requestPath, {
      method: request?.method,
      body: request?.body,
      upload: request?.upload,
      timeoutMs
    })
  } catch (error) {
    // A failed rename PATCH must not strand the app on the temporary primary:
    // restore the original active profile and restart its backend.
    if (profileRename) {
      try {
        await profileRename.rollback()
      } catch (rollbackError) {
        rememberLog(`Failed to restore primary profile after rename error: ${String(rollbackError)}`)
      }
    }

    throw error
  }

  try {
    desktopProfilePreferences.afterProfileRequest(null, request, response, connection.mode)
  } finally {
    await profileRename?.complete()
  }

  return response
}

// Format an api-request failure for desktop.log. The renderer only ever sees
// the invoke rejection; the real stack lives here in main, so persist it
// before rethrowing. Clamp: paths and error detail must not bloat the log.
function formatApiRequestFailure(
  request: { method?: string; path?: string } | null | undefined,
  error: unknown
): string {
  const method = String(request?.method ?? 'GET').toUpperCase()
  const path = String(request?.path ?? '(no path)').slice(0, 500)
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)

  return `[scout:api ${method} ${path}] ${detail}`.slice(0, 6000)
}

ipcMain.handle('scout:api', async (_event, request) => {
  // Hold the deletion gate for BOTH profile deletes and renames: a concurrent
  // renderer reconnect entering ensureBackend() mid-mutation would otherwise
  // respawn the old-name backend and recreate its SCOUT_HOME (#45474).
  const deletingProfile = profileNameFromDeleteRequest(request)
  const mutatingProfile = deletingProfile || profileRenameFromRequest(request)?.oldName || null
  const registryConnectionId = apiRequestRegistryConnectionId(request)

  try {
    if (deletingProfile && registryConnectionId) {
      return await dispatchConnectionScopedProfileDelete(request, {
        acquire: profile => profileDeletionGate.acquire(profile),
        connectionKind: connectionId => registryConnectionKind(connectionId),
        dispatch: routeProfile =>
          dispatchRegistryApiRequest(request, registryConnectionId, routeProfile, deletingProfile),
        isDefaultProfile: profile => profile === 'default',
        isValidProfileName: profile => PROFILE_NAME_RE.test(profile),
        prepareLocal: localRequest => prepareProfileDeleteRequest(localRequest).then(() => undefined),
        teardownConnection: async () => undefined
      })
    }

    if (!mutatingProfile) {
      return await handleScoutApiRequest(request)
    }

    const releaseProfileDeletion = profileDeletionGate.acquire(mutatingProfile)

    return await handleScoutApiRequest(request).finally(releaseProfileDeletion)
  } catch (error) {
    // Persist the failure (full stack) before the rejection crosses to the
    // renderer, where the invoke wrapper strips it to a one-line message.
    rememberLog(formatApiRequestFailure(request, error))
    flushDesktopLogBufferSync()
    throw error
  }
})

// Speech claims outlive instant cues so throttled peer windows cannot replay a reply.
const ownsAmbientCue: ReturnType<typeof createAmbientClaimArbiter> = createAmbientClaimArbiter()
ipcMain.handle('scout:ambient:claim', (_event: IpcMainInvokeEvent, key: unknown): boolean =>
  ownsAmbientCue(String(key ?? ''))
)

const nativeNotifications = registerNativeNotifications({
  getMainWindow: (): BrowserWindow | null => mainWindow,
  focusWindow
})

// Data-URL file load cap (composer attach + local previews). Main owns the
// persisted MB value so every IPC read honours Settings → Chat without the
// renderer having to pass maxBytes on each call. Default is 16 MB; clamp
// lives in hardening.ts.
const DATA_URL_READ_MAX_CONFIG_PATH = path.join(app.getPath('userData'), 'data-url-read-max.json')

function readPersistedDataUrlReadMaxMb() {
  try {
    return clampDataUrlReadMaxMb(JSON.parse(fs.readFileSync(DATA_URL_READ_MAX_CONFIG_PATH, 'utf8')).maxMb)
  } catch {
    return DATA_URL_READ_DEFAULT_MAX_MB
  }
}

let dataUrlReadMaxMb = readPersistedDataUrlReadMaxMb()

function persistDataUrlReadMaxMb(maxMb) {
  const next = clampDataUrlReadMaxMb(maxMb)
  dataUrlReadMaxMb = next

  try {
    fs.mkdirSync(path.dirname(DATA_URL_READ_MAX_CONFIG_PATH), { recursive: true })
    fs.writeFileSync(DATA_URL_READ_MAX_CONFIG_PATH, JSON.stringify({ maxMb: next }, null, 2), 'utf8')
  } catch (error) {
    rememberLog(`[data-url-read-max] write failed: ${error.message}`)
  }

  return next
}

ipcMain.handle('scout:data-url-read-max:get', () => ({
  maxMb: dataUrlReadMaxMb,
  // Keep the default bytes constant visible for tests / diagnostics.
  defaultMaxMb: DATA_URL_READ_DEFAULT_MAX_MB,
  maxBytes: dataUrlReadMaxBytesFromMb(dataUrlReadMaxMb)
}))

ipcMain.handle('scout:data-url-read-max:set', (_event, maxMb) => {
  const next = persistDataUrlReadMaxMb(maxMb)

  return {
    maxMb: next,
    defaultMaxMb: DATA_URL_READ_DEFAULT_MAX_MB,
    maxBytes: dataUrlReadMaxBytesFromMb(next)
  }
})

ipcMain.handle('scout:readFileDataUrl', async (_event, filePath) => {
  // Backend-reported paths are WSL/POSIX (`/home/...`, `/mnt/c/...`); on a
  // Windows host bridge them to a UNC/drive form, same as directory reads.
  const bridgedPath = resolveIpcFileReadPath(filePath)

  return readFileDataUrlForIpc(bridgedPath, {
    maxBytes: dataUrlReadMaxBytesFromMb(dataUrlReadMaxMb),
    mimeType: mimeTypeForPath(resolveRequestedPathForIpc(bridgedPath, { purpose: 'File preview' })),
    purpose: 'File preview'
  })
})

// Remote attachment transfer is independent of the preview / Settings path.
// Keep a finite cap so Electron + base64 memory stays bounded while archives
// can exceed the default 16 MiB preview ceiling (and still fit the gateway
// WebSocket frame limit after base64 expansion).
ipcMain.handle('scout:readFileDataUrlForAttach', async (_event, filePath) => {
  const bridgedPath = resolveIpcFileReadPath(filePath)

  return readFileDataUrlForIpc(bridgedPath, {
    maxBytes: ATTACHMENT_UPLOAD_DEFAULT_MAX_BYTES,
    mimeType: mimeTypeForPath(resolveRequestedPathForIpc(bridgedPath, { purpose: 'Attachment upload' })),
    purpose: 'Attachment upload'
  })
})

ipcMain.handle('scout:readFileText', async (_event, filePath) => {
  const { resolvedPath, stat } = await resolveReadableFileForIpc(resolveIpcFileReadPath(filePath), {
    maxBytes: TEXT_PREVIEW_SOURCE_MAX_BYTES,
    purpose: 'Text preview'
  })

  const ext = path.extname(resolvedPath).toLowerCase()
  const handle = await fs.promises.open(resolvedPath, 'r')
  const bytesToRead = Math.min(stat.size, TEXT_PREVIEW_MAX_BYTES)

  try {
    const buffer = Buffer.alloc(bytesToRead)
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0)

    return {
      binary: looksBinary(buffer.subarray(0, Math.min(bytesRead, 4096))),
      byteSize: stat.size,
      language: PREVIEW_LANGUAGE_BY_EXT[ext] || 'text',
      mimeType: mimeTypeForPath(resolvedPath),
      path: resolvedPath,
      text: buffer.subarray(0, bytesRead).toString('utf8'),
      truncated: stat.size > TEXT_PREVIEW_MAX_BYTES
    }
  } finally {
    await handle.close()
  }
})

// Runtime desktop plugins load their FULL source through this door.
// `scout:readFileText` is the *preview* read and silently truncates at
// TEXT_PREVIEW_MAX_BYTES (512 KiB) — for a plugin that means evaluating half a
// file. Dedicated generous cap, full read, and a hard EFBIG (via maxBytes)
// instead of truncation when the source exceeds it.
const PLUGIN_SOURCE_MAX_BYTES = 16 * 1024 * 1024

ipcMain.handle('scout:readPluginSource', async (_event: unknown, filePath: unknown) => {
  const { resolvedPath, stat } = await resolveReadableFileForIpc(filePath, {
    maxBytes: PLUGIN_SOURCE_MAX_BYTES,
    purpose: 'Plugin source'
  })

  return {
    byteSize: stat.size,
    path: resolvedPath,
    text: await fs.promises.readFile(resolvedPath, 'utf8'),
    truncated: false
  }
})

ipcMain.handle('scout:selectPaths', async (_event, options: any = {}) => {
  const properties = selectPathsDialogProperties(options || {})

  let resolvedDefaultPath

  if (options?.defaultPath) {
    try {
      // On a Windows host with a WSL backend the cwd may be a POSIX/WSL path;
      // bridge it to a UNC/drive form the native dialog can actually open.
      const bridged = IS_WINDOWS
        ? resolvePickerDefaultPath(String(options.defaultPath), undefined, options?.profile)
        : String(options.defaultPath)

      resolvedDefaultPath = bridged ? path.resolve(bridged) : undefined
    } catch {
      resolvedDefaultPath = undefined
    }
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: options?.title || 'Add context',
    defaultPath: resolvedDefaultPath,
    properties: properties as any,
    filters: Array.isArray(options?.filters) ? options.filters : undefined
  })

  if (result.canceled) {
    return []
  }

  return result.filePaths
})

ipcMain.handle('scout:writeClipboard', (_event, text) => {
  clipboard.writeText(String(text || ''))

  return true
})

// Native save-location picker (profile export etc.) — the write itself happens
// elsewhere (the backend, for profile archives); this only picks the path.
ipcMain.handle('scout:selectSavePath', async (_event, options: any = {}) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options?.title || 'Save',
    defaultPath: options?.defaultPath ? String(options.defaultPath) : undefined,
    filters: Array.isArray(options?.filters) ? options.filters : undefined
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  return result.filePath
})

// Paired reader for the GUI terminal's paste chord: the renderer's
// navigator.clipboard.readText() throws "Document is not focused" whenever a
// portaled overlay has focus, and there's no way to route a read through the
// canvas. The main process has no such gate.
ipcMain.handle('scout:readClipboard', () => clipboard.readText())

ipcMain.handle('scout:saveGatewayFile', (_event, payload) => saveGatewayFile(payload))

ipcMain.handle('scout:saveImageFromUrl', (_event, url) => saveImageFromUrl(String(url || '')))

// The custom context menu's edit verbs. They act on the SENDER's focused
// element, so the renderer restores focus to the editable before invoking.
ipcMain.handle('scout:context-menu:edit', (event, command) => {
  const contents = event.sender

  if (command === 'copy') {
    contents.copy()
  } else if (command === 'cut') {
    contents.cut()
  } else if (command === 'paste') {
    contents.paste()
  } else if (command === 'selectAll') {
    contents.selectAll()
  }
})

// Copy the image under the sender's LAST context-menu gesture. Chromium only
// exposes image bytes through copyImageAt, and only main saw the coordinates.
ipcMain.handle('scout:context-menu:copy-image', event => {
  const point = lastContextMenuPoint.get(event.sender.id)

  if (point) {
    event.sender.copyImageAt(point.x, point.y)
  }
})

ipcMain.handle('scout:context-menu:spellcheck', (event, action) => {
  const kind = action?.kind
  const word = String(action?.word || '')

  if (!word) {
    return
  }

  if (kind === 'replace') {
    event.sender.replaceMisspelling(word)
  } else if (kind === 'add') {
    event.sender.session.addWordToSpellCheckerDictionary(word)
  }
})

// Guest dictionary add: the webview TAG exposes replaceMisspelling but no
// session API, so the renderer names the guest by webContents id.
ipcMain.handle('scout:context-menu:guest-add-word', (_event, payload) => {
  const word = String(payload?.word || '')
  const guest = electronWebContents.fromId(Number(payload?.webContentsId))

  if (word && guest && !guest.isDestroyed()) {
    guest.session.addWordToSpellCheckerDictionary(word)
  }
})

ipcMain.handle('scout:capturePreview', async (_event, payload) => {
  const guest = electronWebContents.fromId(Number(payload?.webContentsId))

  return capturePreviewContents(guest, payload?.rect, payload?.viewport)
})

ipcMain.handle('scout:saveImageBuffer', async (_event, payload) => {
  const data = payload?.data

  if (!data) {
    throw new Error('saveImageBuffer: missing data')
  }

  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)

  return writeComposerImage(buffer, payload?.ext || '.png', payload?.name)
})

ipcMain.handle('scout:savePastedText', async (_event, payload) => {
  const text = typeof payload?.text === 'string' ? payload.text : ''

  if (!text) {
    throw new Error('savePastedText: missing text')
  }

  return writeComposerPaste(SCOUT_HOME, text)
})

ipcMain.handle('scout:saveClipboardImage', async () => {
  const image = clipboard.readImage()

  if (image && !image.isEmpty()) {
    return writeComposerImage(image.toPNG(), '.png')
  }

  // WSL2/WSLg doesn't bridge clipboard *images* from the Windows host to the
  // Linux clipboard Electron reads, so a host screenshot looks empty above.
  // Pull it straight off the Windows clipboard via PowerShell as a fallback.
  if (IS_WSL) {
    const png = readWslWindowsClipboardImage()

    if (png) {
      return writeComposerImage(png, '.png')
    }
  }

  return ''
})

ipcMain.handle('scout:normalizePreviewTarget', (_event, target, baseDir) =>
  normalizePreviewTarget(String(target || ''), baseDir ? String(baseDir) : '')
)

ipcMain.handle('scout:watchPreviewFile', (event, url) => watchPreviewFile(event.sender, String(url || '')))

ipcMain.handle('scout:watchDirectory', (event, dir) => watchDirectory(event.sender, String(dir || '')))

ipcMain.handle('scout:stopPreviewFileWatch', (_event, id) => stopPreviewFileWatch(String(id || '')))

// Each renderer reports the turns it has in flight; the quit guard reads the
// merged picture. Keyed by webContents id so a closed window stops counting.
const activeWorkByWebContents = new Map<number, ActiveWork>()

// The same merged picture drives background throttling: chat windows run
// unthrottled while any turn is in flight (streaming must paint while hidden)
// and fall back to Chromium's default throttling at idle. See stream-throttle.ts.
const streamThrottle = createStreamThrottle()

function updateStreamThrottleFromActiveWork() {
  streamThrottle.update(mergeActiveWork(activeWorkByWebContents.values()).count > 0)
}

ipcMain.on('scout:active-work', (event, payload) => {
  const id = event.sender.id

  if (!activeWorkByWebContents.has(id)) {
    event.sender.once('destroyed', () => {
      activeWorkByWebContents.delete(id)
      updateStreamThrottleFromActiveWork()
    })
  }

  activeWorkByWebContents.set(id, normalizeActiveWork(payload))
  updateStreamThrottleFromActiveWork()
})

ipcMain.on('scout:titlebar-theme', (_event, payload) => {
  if (!payload || !isHexColor(payload.background) || !isHexColor(payload.foreground)) {
    return
  }

  rendererTitleBarTheme = {
    background: payload.background,
    foreground: payload.foreground
  }

  // Repaint the native (Windows/Linux) titlebar overlay on every open chat
  // window, not just the primary — instance peers and session windows share the
  // one app theme. applyTitleBarOverlay no-ops on the frameless pet overlay.
  for (const win of BrowserWindow.getAllWindows()) {
    applyTitleBarOverlay(win)
  }
})

// Pin the native appearance to the app theme (see NATIVE_THEME_CONFIG_PATH).
ipcMain.on('scout:native-theme', (_event, mode) => {
  if (!THEME_SOURCES.has(mode)) {
    return
  }

  if (nativeTheme.themeSource !== mode) {
    nativeTheme.themeSource = mode
    writePersistedThemeSource(mode)
  }
})

// See-through window translucency. Persist + re-apply to every open window at
// runtime (no recreation, so caching/sessions are untouched).
//
// The intensity slider is a HOT path: ~100 updates per drag. Two things make
// that cheap. Native work is diffed, so an intensity-only change under glass
// touches nothing (it's painted by the renderer). And the disk write is
// coalesced onto a trailing timer, because writePersistedTranslucency is a
// synchronous writeFileSync and doing one per tick blocks the main process
// mid-drag. Only a cold launch reads that file, so it just has to be correct
// once the hand comes off the slider.
let translucencyWriteTimer = null

function scheduleTranslucencyWrite() {
  if (translucencyWriteTimer) {
    clearTimeout(translucencyWriteTimer)
  }

  translucencyWriteTimer = setTimeout(() => {
    translucencyWriteTimer = null
    writePersistedTranslucency(translucencyState)
  }, 250)
}

// Flush a pending write before the process can exit, so a quit landing inside
// the debounce window doesn't lose the setting.
app.on('before-quit', () => {
  if (translucencyWriteTimer) {
    clearTimeout(translucencyWriteTimer)
    translucencyWriteTimer = null
    writePersistedTranslucency(translucencyState)
  }
})

// Close the pooled keep-alive sockets on quit so lingering connections can't
// hold the event loop open or leak FDs past app teardown.
app.on('will-quit', () => {
  destroyKeepaliveAgents()
  nativeNotifications.dispose()
  quitFinalization.arm()
})

app.on('quit', () => {
  quitFinalization.cancel()
})

// Answered synchronously so preload can publish the verdict before the
// renderer's first script — see the note there on why it cannot decide this
// itself. Registered at module scope, which runs long before any window.
ipcMain.on('scout:translucency:support', event => {
  event.returnValue = { glass: GLASS_SUPPORTED, translucency: TRANSLUCENCY_SUPPORTED }
})

// Feature-flag facts the renderer needs before first paint (same sendSync
// pattern as translucency). Resolved in feature-flags.ts from the launch
// argv and the artifact's channel: `--local` (from `scout desktop --local`
// or directly on Scout.exe, a shortcut edit) gates the local-models GUI on
// stable builds, and canary builds get the same surfaces by default. Launch
// flags survive self-relaunches because collectRelaunchArgs only strips
// internal flags.
ipcMain.on('scout:feature-flags', (event: IpcMainEvent): void => {
  event.returnValue = {
    ...resolveFeatureFlags({
      argv: process.argv,
      canary: resolveUpdaterChannelFromStamp() === 'canary'
    }),
    guestOnboarding: GUEST_ONBOARDING
  }
})

ipcMain.on('scout:translucency', (_event, payload) => {
  const next = normalizeTranslucency(payload, GLASS_SUPPORTED)
  const previous = translucencyState

  if (
    next.intensity === previous.intensity &&
    next.fade === previous.fade &&
    next.mode === previous.mode &&
    next.material === previous.material &&
    next.scope === previous.scope
  ) {
    return
  }

  translucencyState = next

  // Which native properties actually moved. `scope` is renderer-only (which
  // surfaces thin), so it never appears here.
  const changed = {
    // The backing follows whether glass is ON, not the intensity behind it.
    backing: glassActive(previous) !== glassActive(next),
    material: vibrancyForTranslucency(previous) !== vibrancyForTranslucency(next),
    opacity: windowOpacityFor(previous) !== windowOpacityFor(next)
  }

  scheduleTranslucencyWrite()

  // The HUD's frost reads the same setting but answers on its own terms (see
  // hudFrostFor) — and it is a transparent window, so it is deliberately not
  // in the chat fan-out below. It self-diffs, so an unrelated change costs
  // nothing native.
  hudIpc.applyHudFrost()

  if (changed.backing || changed.material || changed.opacity) {
    for (const win of BrowserWindow.getAllWindows()) {
      applyWindowTranslucency(win, changed)
    }
  }
})

// Keep-awake: hold the machine awake for long/overnight runs. Main owns the one
// blocker and its persisted state so a cold launch restores it (applied on
// ready — powerSaveBlocker needs the app ready). The renderer toggles it from
// Settings → Advanced over IPC. See store/keep-awake.
const KEEP_AWAKE_CONFIG_PATH = path.join(app.getPath('userData'), 'keep-awake.json')
const keepAwake = createKeepAwake(powerSaveBlocker)

function readPersistedKeepAwake() {
  try {
    return JSON.parse(fs.readFileSync(KEEP_AWAKE_CONFIG_PATH, 'utf8')).on === true
  } catch {
    return false
  }
}

ipcMain.on('scout:keep-awake', (_event, on) => {
  const enabled = Boolean(on)
  keepAwake.set(enabled)

  try {
    fs.mkdirSync(path.dirname(KEEP_AWAKE_CONFIG_PATH), { recursive: true })
    fs.writeFileSync(KEEP_AWAKE_CONFIG_PATH, JSON.stringify({ on: enabled }, null, 2), 'utf8')
  } catch (error) {
    rememberLog(`[keep-awake] write failed: ${error.message}`)
  }
})

// Quick Entry: the renderer reads the live registration state on settings mount
// and writes the preference back. Main is authoritative — it owns the OS
// accelerator — so both handlers return the state that ACTUALLY resulted,
// including `registered: false` + `error: 'taken'` when another app owns the
// chord. See electron/quick-entry.ts + store/quick-entry.
ipcMain.handle('scout:quick-entry:settings:get', async () => {
  const settings = readQuickEntrySettings()
  const state = quickEntryShortcut.current()

  // Ground truth is what the last apply produced; the shortcut we report is the
  // live one (a saved-but-rejected chord still shows what the user asked for).
  return {
    enabled: settings.enabled,
    error: state.error,
    registered: state.registered,
    shortcut: settings.enabled ? state.shortcut : settings.shortcut
  }
})

ipcMain.handle('scout:quick-entry:settings:set', async (_event, patch) => {
  const current = readQuickEntrySettings()

  const next = sanitizeQuickEntrySettings({
    enabled: patch?.enabled === undefined ? current.enabled : patch.enabled === true,
    shortcut: typeof patch?.shortcut === 'string' && patch.shortcut.trim() ? patch.shortcut : current.shortcut
  })

  writeQuickEntrySettings(next)

  return applyQuickEntrySettings(next)
})

// Quick window → main → PRIMARY renderer. We never submit here: the renderer
// owns the one prompt-submit path, and forwarding keeps it that way. The
// payload is `{ target, text }` — target routing (current chat / a picked
// session / new) is the renderer's job too.
ipcMain.on('scout:quick-entry:submit', (_event, payload) => {
  hideQuickEntryWindow()

  const text = typeof payload?.text === 'string' ? payload.text.trim() : ''

  if (!text) {
    return
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    rememberLog('[quick-entry] dropped a submit: no primary window to route it to')

    return
  }

  // Deliberately does NOT raise/focus the main window — the user asked to fire
  // a prompt from wherever they were, not to be yanked into the app.
  mainWindow.webContents.send('scout:quick-entry:submit', {
    target: typeof payload?.target === 'string' && payload.target ? payload.target : 'current',
    text
  })
})

// Primary renderer → main → quick window: gateway connection state + the
// recent-session list for the target picker. Cached so a quick window spawned
// AFTER the last push still boots from truth instead of "disconnected".
ipcMain.on('scout:quick-entry:state', (_event, payload) => {
  quickEntryLastState = payload ?? null

  if (quickEntryWindow && !quickEntryWindow.isDestroyed()) {
    quickEntryWindow.webContents.send('scout:quick-entry:state', payload)
  }
})

ipcMain.on('scout:quick-entry:dismiss', () => hideQuickEntryWindow())

// Disable F12 DevTools: maintained in the main process so a cold launch
// restores it before any window is shown (applied on ready). The renderer
// toggles it from Settings → Advanced over IPC. See store/disable-f12.
const DISABLE_F12_CONFIG_PATH = path.join(app.getPath('userData'), 'disable-f12.json')

function readPersistedDisableF12() {
  try {
    return JSON.parse(fs.readFileSync(DISABLE_F12_CONFIG_PATH, 'utf8')).on === true
  } catch {
    return false
  }
}

ipcMain.on('scout:devtools:disable-f12', (_event, on) => {
  f12Blocked = Boolean(on)

  try {
    fs.mkdirSync(path.dirname(DISABLE_F12_CONFIG_PATH), { recursive: true })
    fs.writeFileSync(DISABLE_F12_CONFIG_PATH, JSON.stringify({ on: f12Blocked }, null, 2), 'utf8')
  } catch (error) {
    rememberLog(`[disable-f12] write failed: ${error.message}`)
  }
})

ipcMain.handle('scout:openExternal', async (_event, url) => {
  const result = await openExternalUrl(url)

  if (result.ok === false && result.reason === 'invalid') {
    throw new Error('Invalid external URL')
  }
})

// ── Find-in-page (Ctrl/Cmd+F) ─────────────────────────────────────────────
// The desktop supports multiple BrowserWindows (one primary plus any
// per-session secondary windows spawned via `scout:window:openSession`).
// Find must run against the requesting window, not a global — otherwise
// Cmd+F pressed in a secondary session window would search the primary
// and the match counter would report matches the user can't see. Resolve
// the sender through `BrowserWindow.fromWebContents(event.sender)` and
// forward `found-in-page` results back to that same sender.

// Lazily-installed forwarder per sender webContents. We track one
// uninstall fn per webContents id and prune entries when the sender goes
// away — Electron does not auto-detach webContents listeners on close,
// so the map is the cleanup path.
const foundInPageForwarders = new Map<number, () => void>()

function ensureFoundInPageForwarder(sender: Electron.WebContents): void {
  if (foundInPageForwarders.has(sender.id)) {
    return
  }

  const uninstall = installFoundInPageForwarder(sender)
  foundInPageForwarders.set(sender.id, uninstall)

  sender.once('destroyed', () => {
    foundInPageForwarders.get(sender.id)?.()
    foundInPageForwarders.delete(sender.id)
  })
}

ipcMain.handle('scout:find-in-page', async (event, query, options) => {
  const win = BrowserWindow.fromWebContents(event.sender)

  if (!win || win.isDestroyed()) {
    return { count: 0 }
  }

  ensureFoundInPageForwarder(event.sender)
  await performFindAfterIndexingStarted(win.webContents, query, options)

  // The match count still arrives asynchronously via `found-in-page`; this
  // reply only acknowledges that Chromium has begun returning this request.
  return { count: 0 }
})

ipcMain.handle('scout:stop-find-in-page', event => {
  const win = BrowserWindow.fromWebContents(event.sender)

  if (!win || win.isDestroyed()) {
    return
  }

  stopFind(win.webContents)
})

// The renderer can't know whether a loopback URL is reachable — only main
// knows which transport backs this gateway. Ask before loading one.
ipcMain.handle('scout:preview:reach', async (event, url) => reachablePreviewUrl(event.sender.id, String(url || '')))

ipcMain.handle('scout:openPreviewInBrowser', async (_event, url) => {
  if (!(await openPreviewInBrowser(url))) {
    throw new Error('Invalid preview URL')
  }
})

// User-configurable default project directory. The renderer reads this on
// settings mount and seeds the value into the picker; writing back persists
// it via writeDefaultProjectDir so resolveScoutCwd picks it up on the next
// session spawn (no app restart needed).
ipcMain.handle('scout:setting:defaultProjectDir:get', async () => ({
  dir: readDefaultProjectDir(),
  defaultLabel: app.getPath('home'),
  resolvedCwd: resolveScoutCwd()
}))

ipcMain.handle('scout:workspace:sanitize', async (_event, cwd) => sanitizeWorkspaceCwd(cwd))

ipcMain.handle('scout:setting:defaultProjectDir:set', async (_event, dir) => {
  const next = typeof dir === 'string' && dir.trim() ? dir.trim() : null

  if (next) {
    try {
      fs.mkdirSync(next, { recursive: true })
    } catch (error) {
      throw new Error(`Could not create directory: ${error.message}`)
    }
  }

  writeDefaultProjectDir(next)

  return { dir: next }
})

ipcMain.handle('scout:setting:defaultProjectDir:pick', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose default project directory',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: readDefaultProjectDir() || app.getPath('home')
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, dir: null }
  }

  return { canceled: false, dir: result.filePaths[0] }
})

ipcMain.handle('scout:fetchLinkTitle', (_event, url) => fetchLinkTitle(url))

ipcMain.handle('scout:resolveFavicon', (_event, url) => resolveFaviconCached(url))

ipcMain.handle('scout:logs:reveal', async () => {
  try {
    await fs.promises.mkdir(path.dirname(DESKTOP_LOG_PATH), { recursive: true })

    if (!fileExists(DESKTOP_LOG_PATH)) {
      await fs.promises.appendFile(DESKTOP_LOG_PATH, '')
    }

    shell.showItemInFolder(DESKTOP_LOG_PATH)

    return { ok: true, path: DESKTOP_LOG_PATH }
  } catch (error) {
    return { ok: false, path: DESKTOP_LOG_PATH, error: error.message }
  }
})

ipcMain.handle('scout:logs:recent', async () => ({ path: DESKTOP_LOG_PATH, lines: scoutLog.slice(-200) }))

// Renderer error-boundary catches (#79428 defect B): the component stack only
// exists in renderer memory, so the boundary posts it here and we persist it
// via the desktop.log pipeline. `on`, not `handle` — the sender may be mid-
// crash and must not await. Flush immediately: a crashing window can be gone
// before the debounced flush timer fires.
ipcMain.on('scout:logs:renderer-error', (_event, report) => {
  const { label, boundary, message, componentStack } = report && typeof report === 'object' ? report : {}
  rememberLog(formatRendererBoundaryReport(label, boundary, message, componentStack))
  flushDesktopLogBufferSync()
})

// The preload reads this small, sanitized payload synchronously so the renderer
// can register the local skin before its first theme paint. It stays independent
// of the selected gateway, which can be an offline remote primary.
ipcMain.on('scout:skin:local', event => {
  // The window route is more specific than the global next-launch preference:
  // a peer can be booting another profile while that preference changes.
  event.returnValue = readLocalSkinPayload(
    SCOUT_HOME,
    windowConnectionRoutes.get(event.sender.id)?.profile,
    primaryProfileKey()
  )
})

// Renderer error toasts (notifyError): the toast shows the summarized copy,
// so the caller posts the full error here for desktop.log. Fire-and-forget,
// like renderer-error — the toast must never depend on this round-trip.
// Clamp: the line is renderer-supplied.
ipcMain.on('scout:logs:renderer-line', (_event, line) => {
  const text = typeof line === 'string' ? line.slice(0, 6000) : ''

  if (!text) {
    return
  }

  rememberLog(text)
  flushDesktopLogBufferSync()
})

// Local filesystem + plugin-root IPC (readDir/reveal/rename/trash/…) — see fs-ipc.ts.
registerFsIpc({
  scoutHome: SCOUT_HOME,
  readActiveDesktopProfile,
  expandUserPath,
  resolveRequestedPathForIpc,
  directoryExists,
  resolveGitBinary
})

// Git-driven features (worktrees, review pane, repo scan) — see git-ipc.ts.
registerGitIpc({ resolveGitBinary, resolveGhBinary })

// Client-side loopback callback for MCP OAuth against remote backends — see
// mcp-oauth-callback-ipc.ts.
registerMcpOauthCallbackIpc()

ipcMain.handle(
  'scout:updates:check',
  async (_event: Electron.IpcMainInvokeEvent, opts?: { force?: boolean }): Promise<UpdaterStatusWire> =>
    checkUpdates({ force: Boolean(opts?.force) }).catch((error: Error & { kind?: string }): UpdaterStatusWire => ({
      supported: true,
      branch: readDesktopUpdateConfig().branch,
      error: error?.kind === GIT_UNUSABLE ? GIT_UNUSABLE : 'check-failed',
      message: error?.message || String(error),
      fetchedAt: Date.now()
    }))
)

ipcMain.handle('scout:updates:apply', async (_event, payload) =>
  applyUpdates().catch(error => ({
    ok: false,
    error: 'apply-failed',
    message: error?.message || String(error)
  }))
)

ipcMain.handle('scout:updates:branch:get', async () => readDesktopUpdateConfig())

ipcMain.handle(
  'scout:updates:branch:set',
  async (_event: Electron.IpcMainInvokeEvent, name: unknown): Promise<{ branch: string }> => {
    assertSourceUpdateChannel(INSTALL_STAMP)
    const branch: string = typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_UPDATE_BRANCH
    writeDesktopUpdateConfig({ branch })

    return { branch }
  }
)

function resolveScoutVersion(scope: { connectionId?: string; profile?: string } = {}): Promise<string> {
  return resolveGatewayVersion(path => handleScoutApiRequest({ ...scope, path, timeoutMs: 5000 }))
}

// Renderer-bundle skew: `scout update` moves the SOURCE TREE, but the UI
// (including bundled plugins like Bot Mode) is compiled into this binary at
// build time. A terminal-side update — or an in-app update whose bundle-swap
// leg failed — leaves the new runtime running under an old renderer, so About
// shows the new version while the sidebar is missing that version's desktop
// features. Compare the build stamp's commit against the tree, scoped to
// apps/desktop/, and warn when the running renderer is provably behind.
// Fail-quiet: dev runs (no stamp), non-git builds, and shallow-clone gaps all
// report in-sync rather than risk a false "your install is torn" warning.
async function detectRendererSkew() {
  return detectBundleSkew(INSTALL_STAMP, runGit, resolveUpdateRoot())
}

// Re-resolve the live Scout version and push it into the native About panel
// just before showing it, so an in-place `scout update` is reflected without
// an app restart. macOS only — `showAboutPanel()` is a no-op elsewhere, and the
// other platforms don't use this menu item.
function showAboutPanelFresh(): void {
  void Promise.all([detectRendererSkew(), resolveScoutVersion()]).then(([skew, version]) => {
    const info: AppVersionInfo = appVersionInfo(INSTALL_STAMP, version, app.getVersion())
    // The product name already identifies canary and commit builds. Never pass
    // through empty/placeholder: the panel would render the bundle's 0.0.0 (#124581).
    const display: string = nativeAboutVersion(info)
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: skew.outOfSync ? `${display} — app build out of date, update the desktop app` : display,
      copyright: 'Copyright © 2026 SpaceshipResearch'
    })
    app.showAboutPanel()
  })
}

ipcMain.handle('scout:version', async (_event, scope?: { connectionId?: string; profile?: string }) => {
  const [skew, version] = await Promise.all([detectRendererSkew(), resolveScoutVersion(scope)])

  return {
    ...appVersionInfo(INSTALL_STAMP, version, app.getVersion()),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    scoutRoot: resolveUpdateRoot(),
    scoutHome: SCOUT_HOME,
    bundleOutOfSync: skew.outOfSync,
    bundleCommitsBehind: skew.desktopCommitsBehind,
    // The install id: sha16 of the canonical install-root path — the key of
    // this install's per-install channel record and its installs/<sha16>/
    // state folder. Same value `scout update --install-id` prints; About
    // renders it as `sha16 (path)`.
    installId: installIdForRoot(resolveUpdateRoot(), canonicalizeInstallPath),
    // The artifact kind of THIS app plus whether the runtime checkout came
    // from a bootstrap installer script — About's Distribution row
    // disambiguates installer shells, bundles, and script installs from these.
    payload: INSTALL_STAMP?.payload,
    installedByScript: isInstallerCreatedCheckout(),
    // What this build carries and where an external backend runs from.
    // Bundled artifacts always run their payload; light artifacts have no
    // runtime and only reach remote backends. External builds classify from
    // the install stamp (git/docker/nix), 'unknown' when it can't be told.
    scoutRuntime: resolveScoutRuntime(),
    // True when the bundle on disk is not the one this process loaded — a
    // plain app restart (no rebuild, no installer) clears the skew above.
    // Packaged only: a dev `--build-only` rewrites build/install-stamp.json
    // under a running `npm start`, which is a rebuild the developer asked for,
    // not a torn install to offer a restart for.
    bundleSwapPending: IS_PACKAGED && detectBundleSwap(INSTALL_STAMP, readBundleSwapStamp(process.resourcesPath))
  }
})

// The About page's "Restart Scout" button (shown when bundleSwapPending):
// load the already-swapped bundle without asking the user to quit manually.
// app.relaunch() re-executes by path, so the fresh process picks up whatever
// bundle now lives there.
ipcMain.handle('scout:app:relaunch', async () => {
  rememberLog('[updates] renderer requested an app relaunch (swapped bundle pending)')
  app.relaunch({ args: buildNoSandboxRelaunchArgs(process.argv.slice(1)) })
  void exitAfterBackendShutdown(0)
})

/** The latest pm/venv/plugin-operation receipt — the machine-readable
 *  surface every medium reads (CLI: `scout pm status`). Returned as one
 *  parsed JSON object: { kind, outcome, venv_rebuild, plugin_bisect,
 *  plugin_checks, ... } or null when no operation has run yet. The file
 *  lives at <SCOUT_HOME>/logs/update_receipts/latest.json — written by
 *  pm syncs (bisect disables, failed rebuilds), plugin update checks,
 *  and (embedded) updates. */
function readLatestSyncReceipt(): Record<string, unknown> | null {
  const receiptPath = path.join(SCOUT_HOME, 'logs', 'update_receipts', 'latest.json')

  try {
    const text = fs.readFileSync(receiptPath, 'utf8')
    // tolerate a BOM (scout writes plain, but editors touch configs)
    const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

    return JSON.parse(stripped)
  } catch {
    return null
  }
}

ipcMain.handle('scout:sync-status', () => readLatestSyncReceipt())

// Python's Path.resolve() equivalent for install-id derivation: realpath when
// the path exists, plain resolve otherwise. Must stay byte-compatible with
// boot_bootstrap._install_key or the CLI and the app would compute two
// different ids for one install.
function canonicalizeInstallPath(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/** True when the runtime checkout was created by a bootstrap installer
 *  (install.sh / install.ps1 / the desktop first-launch bootstrap): those all
 *  finish by writing `.scout-bootstrap-complete` into the checkout root, and
 *  `scout update` preserves the file, so a manual clone never grows one. A
 *  missing checkout (sealed bundled payloads, remote backends) is not
 *  installer-created. */
export function isInstallerCreatedCheckout(root: string | null = ACTIVE_SCOUT_ROOT): boolean {
  if (!root) {
    return false
  }

  try {
    return fs.existsSync(path.join(root, path.basename(BOOTSTRAP_COMPLETE_MARKER)))
  } catch {
    return false
  }
}

/** Classify what this build carries (embedded / light / external). The stamp's
 *  `payload` decides the first two; an external build classifies its root via
 *  the canonical-root checkout stamp plus the bootstrap marker, or the app
 *  stamp's `source`, so About's Runtime row names
 *  git/docker/nix/desktop-bootstrap instead of a bare "external". */
function resolveScoutRuntime() {
  const stamp = INSTALL_STAMP as InstallStamp | null

  if (stamp?.payload === 'light') {
    return { type: 'light' }
  }

  if (stamp?.payload === 'bundled') {
    return { type: 'embedded' }
  }

  const root = resolveUpdateRoot()
  const canonicalStamp = readCanonicalInstallStamp()

  // A desktop first-launch bootstrap is attested by the bootstrap-complete
  // marker, not by the stamp: the stamp is the checkout's own identity
  // (source: git, written by the Python completion tail).
  if (canonicalStamp?.updateMechanism === 'self' && readBootstrapMarker()) {
    return { type: 'desktop-bootstrap', root }
  }

  const source = stamp?.source

  if (source === 'git') {
    return { type: 'git', root }
  }

  if (source === 'nix') {
    return { type: 'nix', root: null }
  }

  if (source === 'docker') {
    return { type: 'docker', root: null }
  }

  return { type: 'unknown' }
}

// ===========================================================================
// Uninstall — remove the Chat GUI (and optionally the agent / user data).
// ===========================================================================
//
// The renderer's About → Danger Zone surfaces three options that mirror the
// CLI exactly: GUI only, Lite (keep user data), Full. We ask the agent to do
// the actual removal via `scout uninstall …` so the cross-platform PATH /
// registry / service / node-symlink cleanup all lives in one place
// (scout_backend/uninstall.py + scout_backend/gui_uninstall.py).
//
// The IPC boundary applies the baked install policy before either callback.
// Only self-managed installs use the Python summary or the cleanup script.

function uninstallVenvPython(): string {
  return getVenvPython(VENV_ROOT)
}

function fallbackUninstallSummary(): UninstallSummaryDetails {
  return {
    scout_home: SCOUT_HOME,
    agent_installed: isScoutSourceRoot(ACTIVE_SCOUT_ROOT) && fileExists(uninstallVenvPython()),
    gui_installed: true,
    source_built_artifacts: [],
    packaged_app_paths: [],
    userdata_dir: app.getPath('userData'),
    userdata_exists: true,
    platform: process.platform,
    probe: 'fallback'
  }
}

async function probeUninstallSummary(): Promise<UninstallSummaryDetails> {
  const py: string = uninstallVenvPython()
  const agentRoot: string = ACTIVE_SCOUT_ROOT

  if (!fileExists(py)) {
    return fallbackUninstallSummary()
  }

  return new Promise<UninstallSummaryDetails>((resolve: (value: UninstallSummaryDetails) => void): void => {
    let stdout: string = ''
    let settled: boolean = false

    const done: (value: UninstallSummaryDetails) => void = (value: UninstallSummaryDetails): void => {
      if (settled) {
        return
      }

      settled = true
      resolve(value)
    }

    try {
      const child: ChildProcess = spawn(
        py,
        ['-m', 'scout_backend.main', 'uninstall', '--gui-summary'],
        hiddenWindowsChildOptions({
          cwd: agentRoot,
          env: { ...process.env, SCOUT_HOME, NO_COLOR: '1' },
          stdio: ['ignore', 'pipe', 'ignore']
        })
      )

      child.stdout.on('data', (chunk: Buffer): void => {
        stdout += chunk.toString()
      })
      child.on('error', (): void => done(fallbackUninstallSummary()))
      child.on('exit', (code: number | null): void => {
        if (code !== 0) {
          return done(fallbackUninstallSummary())
        }

        try {
          const line: string = stdout.trim().split('\n').filter(Boolean).pop() || '{}'
          const parsed: UninstallSummaryDetails = JSON.parse(line)
          // The app bundle the renderer would be removing on *this* machine,
          // resolved from the running exe (the Python probe only knows the
          // standard locations, not where THIS build actually runs from).
          parsed.running_app_path = resolveRemovableAppPath(process.execPath, process.platform, process.env)
          done(parsed)
        } catch {
          done(fallbackUninstallSummary())
        }
      })
      setTimeout((): void => done(fallbackUninstallSummary()), 8000)
    } catch {
      done(fallbackUninstallSummary())
    }
  })
}

async function runDesktopUninstall(mode: string): Promise<DesktopUninstallResult> {
  let uninstallArgs: string[]

  try {
    uninstallArgs = uninstallArgsForMode(mode)
  } catch (error) {
    return { ok: false, error: 'invalid-mode', message: error.message }
  }

  const venvPy = uninstallVenvPython()

  if (!fileExists(venvPy)) {
    return {
      ok: false,
      error: 'agent-missing',
      message: `Can't run the uninstaller: no Scout agent venv at ${VENV_ROOT}.`
    }
  }

  // Interpreter choice (Finding 3): lite/full rmtree the venv that holds the
  // running python.exe. On Windows a running .exe is mandatory-locked, so the
  // rmtree must NOT be driven by the venv's own interpreter — use a system
  // Python with PYTHONPATH=<agentRoot> so `import scout_backend` resolves from
  // source while the venv is torn down. gui-only doesn't touch the venv, so the
  // venv python is fine there. If no system Python exists (the Windows edge
  // case), fall back to the venv python — gui-only is unaffected; lite/full may
  // leave venv remnants the user can delete, which we log.
  let py = venvPy
  let pythonPath = null

  if (modeRemovesAgent(mode)) {
    const sysPy = await findSystemPython()

    if (sysPy) {
      py = sysPy
      pythonPath = ACTIVE_SCOUT_ROOT
    } else if (IS_WINDOWS) {
      rememberLog(
        '[uninstall] no system Python found for lite/full on Windows; falling back ' +
          'to the venv python — venv files locked by the running interpreter may ' +
          'remain and need manual deletion.'
      )
    }
  }

  const appPath = resolveRemovableAppPath(process.execPath, process.platform, process.env)
  const removeBundle = shouldRemoveAppBundle(IS_PACKAGED, appPath) ? appPath : null

  // CRITICAL (Windows): tear down every backend the desktop owns and wait for
  // the venv shim to unlock BEFORE the cleanup script runs. lite/full delete
  // the venv, and even gui-only removes the install tree's GUI artifacts — a
  // live backend grandchild (gateway / pty / REPL) holding a mandatory file
  // lock would make the script's rmdir half-fail (#37532 for the update path).
  // Reuses the incident-hardened update teardown; no-op on macOS/Linux.
  try {
    await releaseBackendLock(ACTIVE_SCOUT_ROOT, 'uninstall')
  } catch (error) {
    rememberLog(`[uninstall] backend teardown errored (continuing): ${error.message}`)
  }

  const scriptArgs = {
    desktopPid: process.pid,
    pythonExe: py,
    pythonPath,
    agentRoot: ACTIVE_SCOUT_ROOT,
    uninstallArgs,
    appPath: removeBundle,
    scoutHome: SCOUT_HOME
  }

  let scriptPath
  let runner
  let runnerArgs

  try {
    if (IS_WINDOWS) {
      scriptPath = path.join(app.getPath('temp'), `scout-uninstall-${Date.now()}.cmd`)
      fs.writeFileSync(scriptPath, buildWindowsCleanupScript(scriptArgs))
      runner = process.env.ComSpec || 'cmd.exe'
      runnerArgs = ['/c', scriptPath]
    } else {
      scriptPath = path.join(app.getPath('temp'), `scout-uninstall-${Date.now()}.sh`)
      fs.writeFileSync(scriptPath, buildPosixCleanupScript(scriptArgs), { mode: 0o755 })
      runner = '/bin/bash'
      runnerArgs = [scriptPath]
    }
  } catch (error) {
    return { ok: false, error: 'script-write-failed', message: error.message }
  }

  try {
    const child = spawn(runner, runnerArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })

    child.unref()
  } catch (error) {
    return { ok: false, error: 'spawn-failed', message: error.message }
  }

  rememberLog(
    `[uninstall] launched detached cleanup (${mode}): ${scriptPath} ` +
      `(removesAgent=${modeRemovesAgent(mode)} removesUserData=${modeRemovesUserData(mode)} bundle=${removeBundle || 'none'})`
  )

  // Give the renderer a beat to show its "uninstalling…" state, then quit so
  // the venv python shim + app bundle unlock and the cleanup script can run.
  isQuittingForHandoff = true
  setTimeout(() => app.quit(), 800)

  return { ok: true, mode, willRemoveAppBundle: Boolean(removeBundle), scriptPath }
}

registerDesktopUninstallIpc({
  ipcMain,
  stamp: INSTALL_STAMP,
  fallbackSummary: fallbackUninstallSummary,
  probeSummary: probeUninstallSummary,
  runUninstall: runDesktopUninstall
})

// Download a VS Code Marketplace extension and return the raw color-theme JSON
// it contributes. No theme code is executed — we only read JSON from the .vsix.
ipcMain.handle('scout:vscode-theme:fetch', async (_event, id) => fetchMarketplaceThemes(String(id || '')))

// Search the Marketplace for color-theme extensions (empty query = top installs).
ipcMain.handle('scout:vscode-theme:search', async (_event, query) => searchMarketplaceThemes(String(query || ''), 20))

// ---------------------------------------------------------------------------
// scout:// deep links (e.g. scout://blueprint/morning-brief?time=08:00,
// scout://mcp/install?name=NAME&config=B64 — the vendor "Add to Scout"
// button, or scout://plugin/install?repo=owner/repo). Dev
// (`SCOUT_DESKTOP_DEV_SERVER`) registers scout-dev:// instead — bare
// Electron or a stale OS handler often owns scout:// on dev machines.
// Parsing is generic ({kind, name, params}); the renderer routes per kind
// and anything install-shaped requires explicit user confirmation there.
// A docs/dashboard "Send to App" button opens this URL; we route it into the
// running app. Three delivery paths: macOS 'open-url',
// Win/Linux running-app 'second-instance' (argv), Win/Linux cold-start argv.
// ---------------------------------------------------------------------------
const SCOUT_PROTOCOL = DEV_SERVER ? 'scout-dev' : 'scout'
/** Schemes accepted when parsing inbound URLs (dev accepts both). */
const DEEPLINK_SCHEMES = DEV_SERVER ? ['scout-dev', 'scout'] : ['scout']
let _pendingDeepLink = null
let _rendererReadyForDeepLink = false
// Set by sendOpenUpdatesRequested() when the renderer cannot hear it yet.
let _pendingOpenUpdates = false

function _extractDeepLink(argv) {
  if (!Array.isArray(argv)) {
    return null
  }

  return argv.find(a => typeof a === 'string' && DEEPLINK_SCHEMES.some(s => a.startsWith(`${s}://`))) || null
}

function handleDeepLink(url) {
  if (!url || typeof url !== 'string') {
    return
  }

  let parsed

  try {
    parsed = new URL(url)
  } catch {
    rememberLog(`[deeplink] ignoring malformed url: ${url}`)

    return
  }

  const scheme = parsed.protocol.replace(/:$/, '')

  if (!DEEPLINK_SCHEMES.includes(scheme)) {
    rememberLog(`[deeplink] ignoring scheme ${scheme} (expected ${DEEPLINK_SCHEMES.join(' or ')})`)

    return
  }

  // scout://blueprint/<key>?slot=val  -> host="blueprint", path="/<key>"
  const kind = parsed.hostname || ''
  const name = decodeURIComponent((parsed.pathname || '').replace(/^\//, ''))
  const params = {}
  parsed.searchParams.forEach((v, k) => {
    params[k] = v
  })
  const payload = { kind, name, params }

  // Route the Windows Copilot hardware key (registered by the MSIX
  // copilotkeyprovider fragment). quick-entry is the eventual summon; for
  // now it falls through to the renderer's deep-link listener. stop and
  // unknown copilot-key paths are activation noise and must not reach the
  // renderer (a tap fires start+stop nearly together; acting on stop would
  // undo the summon).
  if (kind === 'copilot-key' && name !== 'start') {
    rememberLog(`[deeplink] ignoring copilot-key path: ${name}`)

    return
  }

  if (!_rendererReadyForDeepLink || !mainWindow || mainWindow.isDestroyed()) {
    _pendingDeepLink = payload

    return
  }

  try {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.focus()
    mainWindow.webContents.send('scout:deep-link', payload)
    rememberLog(`[deeplink] delivered ${kind}/${name}`)
  } catch (err) {
    rememberLog(`[deeplink] delivery failed: ${err.message}`)
  }
}

// Renderer calls this (via IPC) once it has mounted its deep-link listener, so
// a link that arrived during boot/install is flushed exactly once.
ipcMain.handle('scout:deep-link-ready', () => {
  _rendererReadyForDeepLink = true

  if (_pendingOpenUpdates) {
    _pendingOpenUpdates = false
    sendOpenUpdatesRequested()
  }

  if (_pendingDeepLink) {
    const queued = _pendingDeepLink
    _pendingDeepLink = null
    handleDeepLink(
      `${SCOUT_PROTOCOL}://${queued.kind}/${encodeURIComponent(queued.name)}` +
        (Object.keys(queued.params).length ? '?' + new URLSearchParams(queued.params).toString() : '')
    )
  }

  return { ok: true }
})

function registerDeepLinkProtocol() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      // Dev: register with the electron exec path + entry script so the OS can
      // relaunch us with the URL. argv[1] is usually "." when launched via
      // `electron .` from apps/desktop — resolve against cwd.
      const entry = path.resolve(process.argv[1])
      app.setAsDefaultProtocolClient(SCOUT_PROTOCOL, process.execPath, [entry])
    } else {
      app.setAsDefaultProtocolClient(SCOUT_PROTOCOL)
    }

    rememberLog(`[deeplink] registered ${SCOUT_PROTOCOL}:// handler`)
  } catch (err) {
    rememberLog(`[deeplink] protocol registration failed: ${err.message}`)
  }
}

// macOS: register the deep link before the lock. Launch Services relaunches
// the app when the default protocol client changes; if the lock is already
// held, that relaunch flashes a second Dock icon and then app.exit(0)s.
// Win/Linux have no Dock and still register on ready.
const preReadyDockSteps = preReadyDockLaunchSteps(process.platform)

if (preReadyDockSteps.includes('register-deep-link')) {
  registerDeepLinkProtocol()
}

// Single-instance lock: deep links on a running app (Win/Linux) arrive as a
// second-instance argv. Without the lock a second `scout://` launch spawns a
// whole new app instead of routing into the running one.
if (!isPrimaryInstance) {
  // Hard-exit, not app.quit(): the before-quit teardown coordinator defers a
  // plain quit (event.preventDefault + async backend shutdown), and in that
  // window `ready` still fires — the lock-losing instance then runs the full
  // startup (shortcut registration, createWindow → startScout), whose
  // reapOrphans() SIGTERMs the running instance's live backend (#87295).
  // app.exit() terminates immediately, before `ready`, so a second launch
  // routes into the running window and never touches backend machinery.
  app.exit(0)
} else {
  // Cold-start --profile must win over the stored preference before
  // startScout() reads active-profile.json. Only the instance that will
  // boot writes: a second launch must not retarget the running app. A missing
  // or invalid flag is a no-op, so the stored profile stays.
  try {
    applyLaunchProfileOverride(process.argv, name => {
      writeActiveDesktopProfile(name)
    })
  } catch (error) {
    console.error('[scout] failed to persist --profile launch override:', error)
  }

  app.on('second-instance', (_event, argv) => {
    const url = _extractDeepLink(argv)

    if (url) {
      handleDeepLink(url)
    }

    ensureMainWindow(mainWindow, {
      isReady: app.isReady(),
      createWindow,
      focusWindow,
      // deep-link delivery focuses a live window after its renderer is ready.
      focusExisting: !url
    })
  })
}

// macOS delivers deep links via 'open-url' — register early (can fire before
// whenReady; handleDeepLink queues until the renderer is ready).
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

app.whenReady().then(() => {
  // Post-update relaunch detection (App Installer arm): when the previous
  // version wrote the one-shot pending-relaunch marker before quitting into
  // an OS package swap, consume it here — the renderer toasts "Scout
  // updated to vX.Y.Z" once its bridge is up. Same-version markers (update
  // never landed) are deleted silently.
  const relaunchInfo: ConsumedRelaunch = consumePendingRelaunch(app, app.getVersion())

  if (relaunchInfo.wasUpdateRelaunch) {
    rememberLog(`[updates] post-update relaunch detected (from ${relaunchInfo.fromVersion})`)
  }

  // Warm the login-shell PATH resolution immediately so it usually completes
  // before the backend start path awaits the same single-flight promise.
  void ensureLoginShellPath()

  if (CRASH_DIAGNOSTICS) {
    startChromiumLogWatcher(CHROMIUM_LOG_PATH)
  }

  const systemCa = installSystemCaTrust(tls)

  if (systemCa.applied) {
    rememberLog(`[tls] trusting ${systemCa.systemCertificateCount} OS CA certificate(s) for backend connections`)
  } else if (systemCa.error) {
    rememberLog(`[tls] could not load OS system CA certificates: ${systemCa.error}`)
  }

  // Keyring-less Linux `--password-store=basic` support. This must run before
  // createWindow() and anything that could touch safeStorage; the narrow
  // platform/switch/guard semantics live in the extracted helper.
  enableBasicPasswordStoreEncryption({
    platform: process.platform,
    passwordStoreSwitch: app.commandLine.getSwitchValue('password-store'),
    safeStorageApi: safeStorage
  })

  // Keychain encryption is opt-in (default OFF). One-shot: rewrite any
  // legacy safeStorage-encrypted secrets as plain so no later launch ever
  // touches the OS keychain unless the user turns encryption on in
  // Settings → Gateway. Must run before createWindow() and the first
  // connection resolution.
  migrateLegacyEncryptedSecretsOnce()

  // Expose the renderer's accessibility tree to the OS (#118271, Windows
  // twin #92607): dictation tools that insert text through the accessibility
  // APIs don't register as screen readers, so Chromium never builds the tree
  // and the composer stays invisible to them. Must run after `ready` (the
  // API's requirement). Opt out with desktop.renderer_accessibility: false
  // (bridged as SCOUT_DESKTOP_RENDERER_ACCESSIBILITY=0); the platform/env
  // decision lives in the extracted helper.
  enableRendererAccessibility({ appApi: app })

  installMediaPermissions()
  installDownloadHandling()
  registerMediaProtocol()
  installEmbedReferer()
  installRemoteHeaderRules()

  if (!preReadyDockSteps.includes('register-deep-link')) {
    registerDeepLinkProtocol()
  }

  installPreviewGuestPreload()

  ensureWslWindowsFonts()
  configureSpellChecker()
  registerPowerResumeListeners()
  keepAwake.set(readPersistedKeepAwake())
  void minimizeToTray.start()
  mainProcessLagWatchdog.start()
  f12Blocked = readPersistedDisableF12()
  // Seed this before the first window exists: a picker can open before
  // startScout() finishes resolving the configured backend.
  const primaryProfile = primaryProfileKey()

  setActiveGatewayProfile(primaryProfile)
  setWslBridgeProfileState(primaryProfile, !primaryBackendIsRemote())
  // Quick Entry's global chord — registered on ready so a cold launch restores
  // it without the renderer visiting Settings. A failed registration is logged
  // here and surfaced in Settings via the IPC state (never silent).
  applyQuickEntrySettings(readQuickEntrySettings())
  installCommandScreenshot({ rendererUrl: DEV_SERVER || pathToFileURL(resolveRendererIndex()).toString() })
  installHudModifierTap({
    rendererUrl: DEV_SERVER || pathToFileURL(resolveRendererIndex()).toString(),
    summon: () => {
      if (!isQuittingForHandoff && !backendShutdown.hasStarted()) {
        openHudWindow(null, null)
      }
    }
  })

  // The popped-out pet must never be stranded on a disconnected display: when
  // the topology changes, pull an off-screen overlay back onto the display
  // that holds the main window (and persist the corrected spot). Unlike the
  // wake indicator this applies on every platform — the pet overlay exists
  // everywhere, and rehomePetOverlay is a cheap no-op while the pet is in the
  // window or still on-screen.
  screen.on('display-added', rehomePetOverlay)

  screen.on('display-metrics-changed', rehomePetOverlay)

  screen.on('display-removed', rehomePetOverlay)

  installApplicationMenuAfterFirstWindow({
    isMac: IS_MAC,
    buildMenu: buildApplicationMenu,
    setApplicationMenu: menu => Menu.setApplicationMenu(menu),
    createWindow
  })

  // Win/Linux cold start: the launching scout:// URL is in our own argv.
  const _coldStartLink = _extractDeepLink(process.argv)

  if (_coldStartLink) {
    handleDeepLink(_coldStartLink)
  }

  app.on('activate', () => {
    // Recreate the primary window if it's gone. Guard on mainWindow directly
    // (not just total window count) so a dock click still restores the main
    // window when only secondary session windows remain open.
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    } else {
      focusWindow(mainWindow)
    }
  })
})

// Seed Chromium's spellchecker with the system locale (falling back to en-US).
// On macOS Electron uses the native spellchecker which ignores this list, but
// on Windows/Linux Chromium downloads Hunspell dictionaries on demand and
// won't enable any without an explicit language.
function configureSpellChecker() {
  try {
    const defaultSession = session.defaultSession

    if (!defaultSession || typeof defaultSession.setSpellCheckerLanguages !== 'function') {
      return
    }

    const available = defaultSession.availableSpellCheckerLanguages || []
    const locale = (app.getLocale && app.getLocale()) || 'en-US'
    const candidates = [locale, locale.split('-')[0], 'en-US', 'en']
    const chosen = candidates.find(lang => available.includes(lang)) || 'en-US'

    defaultSession.setSpellCheckerLanguages([chosen])
  } catch (error) {
    rememberLog(`Spellchecker setup failed: ${error.message}`)
  }
}

// The agent runs on the hosted backend, so quitting the app never stops its work.
function quitStopsBackendWork(): boolean {
  return false
}

// Ask before a quit kills a turn in flight. True when the quit was intercepted
// and the confirmation is on screen; the confirm button re-enters before-quit with
// the latch set and falls straight through to the teardown below.
function heldQuitForActiveWork(event: Electron.Event): boolean {
  if (SKIP_QUIT_CONFIRM || quitConfirmedWithActiveWork || isQuittingForHandoff) {
    return false
  }

  if (quitPromptOpen) {
    event.preventDefault()

    return true
  }

  const prompt = quitPromptFor(
    mergeActiveWork(activeWorkByWebContents.values()),
    isQuittingForHandoff,
    quitStopsBackendWork()
  )

  // A tray quit with live work still needs the ordinary visible confirmation.
  if (prompt && minimizeToTray.status().available) {
    minimizeToTray.restore()
  }

  // A hidden aux window must never parent the quit prompt: the dialog would
  // be invisible and the held quit unanswerable (#116376 §E).
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find(window => window.isVisible())

  if (!prompt || !parent || parent.isDestroyed()) {
    return false
  }

  event.preventDefault()
  quitPromptOpen = true

  void dialog
    .showMessageBox(parent, {
      buttons: [...prompt.buttons],
      cancelId: 0,
      defaultId: 0,
      detail: prompt.detail,
      message: prompt.message,
      type: 'question'
    })
    .then(({ response }) => {
      quitPromptOpen = false

      if (response === 1) {
        quitConfirmedWithActiveWork = true
        app.quit()
      }
    })
    .catch(() => {
      // A dialog we can't show must not become a quit we can't perform.
      quitPromptOpen = false
      quitConfirmedWithActiveWork = true
      app.quit()
    })

  return true
}

app.on('before-quit', event => {
  // Runs ahead of every teardown below, so "Keep Running" leaves the app
  // exactly as it was.
  if (heldQuitForActiveWork(event)) {
    return
  }

  minimizeToTray.beginQuit()
  mainProcessLagWatchdog.stop()

  const backendNeedsWait = backendQuitNeedsWait({
    connectionPending: backendConnectionState.getPendingPromise() !== null,
    poolPending: false,
    processAttached: backendConnectionState.getProcess() !== null,
    shutdownPending: backendShutdown.isPending()
  })

  const teardownTasks: QuitTeardownTask[] = [
    { run: (): Promise<void> => backendShutdown.run(), waitForCompletion: backendNeedsWait }
  ]

  if (quitTeardown.begin(teardownTasks)) {
    event.preventDefault()
  }

  // Clean quit mid-boot should not trip next-launch --no-sandbox (#38216).
  // FATAL GPU aborts skip before-quit, leaving the `booting` marker in place.
  // Keyed on sticky (not active): a manual --no-sandbox run still records a
  // clean quit, while an engaged fallback keeps its sticky marker.
  if (IS_WINDOWS && !windowsSandboxFallbackSticky) {
    try {
      writeSandboxMarker(app.getPath('userData'), markerAfterSuccessfulBoot({ fallbackActive: false }))
    } catch {
      void 0
    }
  }

  // The always-on-top overlay isn't a "real" app window; close it so a stray
  // pet can't keep the process alive or float over a quit app.
  closePetOverlay()

  // Same for the HUD — an always-on-top panel outliving the app would leave a
  // floating composer with nothing behind it. Close it directly rather than via
  // closeHudWindow(): that also re-shows the main window, which is wrong on the
  // way out (and `hudRestoreMainWindow` may still be armed from entering HUD).
  hudSnapShortcut.dispose()

  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.removeAllListeners('closed')
    hudWindow.destroy()
  }

  hudWindow = null

  // Same for the Quick Entry composer — and release its global accelerator so a
  // quitting Scout never keeps another app's chord hostage.
  closeQuickEntryWindow()

  // Quitting mid-install should stop the installer, not orphan it.
  if (bootstrapAbortController) {
    try {
      bootstrapAbortController.abort()
    } catch {
      void 0
    }
  }

  if (desktopLogFlushTimer) {
    clearTimeout(desktopLogFlushTimer)
    desktopLogFlushTimer = null
  }

  flushDesktopLogBufferSync()
  closePreviewWatchers()

  void backendShutdown.run()
})

app.on('window-all-closed', () => {
  // macOS convention: keep the process alive in the Dock when the user closes
  // the last window. But when we're handing off to a detached updater / swap /
  // uninstall script, the process MUST exit so the script can replace or remove
  // the bundle and relaunch — without this the script's PID-wait spins to its
  // full timeout and the user is left with an invisible app (or an uninstall
  // that appears to do nothing).
  if (process.platform !== 'darwin' || isQuittingForHandoff) {
    app.quit()
  }
})
