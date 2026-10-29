# Scout mobile shell (Expo, iOS + Android)

The phone app is a thin native shell around the **desktop renderer** (`apps/desktop/src`), so every
desktop feature exists on the phone without a second UI. Do not rebuild desktop surfaces here.

- `src/ScoutScreen.tsx` hosts the renderer in a WebView. Before the page's scripts run it sets
  `window.__SCOUT_REMOTE__ = { baseUrl, token }`, which `apps/desktop/src/platform/web-bridge.ts`
  turns into the `window.scoutDesktop` bridge Electron's preload normally provides.
- Phone-only abilities are offered to the page as `window.scoutNative.request(kind, payload)`
  (handled in `ScoutScreen.handle`): `location`, `notify`, `activity`, `watch`, `take-focus`,
  `commute-start`, `commute-stop`, `commute-status`, `unpair`, `ws-open`, `ws-send`, `ws-close`.
  Add a kind there, not a new channel.
  The page's `WebSocket` is replaced by a native HTTP/1.1 socket (`src/gateway-ws.ts`): Tailscale
  Serve's HTTPS front speaks HTTP/2 and does not bridge WebSocket CONNECT, so WKWebView `wss://`
  fails before open.
- A new pairing remounts `ScoutScreen` (keyed by address + token): a WebView whose `source` is
  unchanged would keep the old token and sit on "Connecting".
- The page owns layout; never focus inputs or open tiles/windows from code on a phone
  (`IS_PHONE` in `apps/desktop/src/platform/phone.ts` makes those no-ops).
- Pairing (`src/pairing.ts`) is one link — the renderer's address with `?token=` — scanned as a QR
  or pasted; it is kept in the OS keychain (expo-secure-store), never in plain storage.
- Lives outside the root npm workspaces on purpose (its own lockfile): React Native pins a
  React version independent of the desktop's.

Dev loop: serve the renderer on the LAN from `apps/desktop` (`npx vite --host 0.0.0.0 --port 5175`;
it proxies `/api` to the backend), run `npx expo start --lan` here, open it in Expo Go.
Background location and geofencing need a development build (not Expo Go).

Commute reminders use `src/commute-background.ts`: its top-level TaskManager task posts token-
authenticated coordinates to the profile from the commute session. The Expo Location plugin adds
iOS background-location mode and the Always permission rationale. iOS Keychain config uses
`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` so updates can run while locked after the first unlock.
Arrival reminders are queued until a fresh route ETA crosses their thresholds, then delivered in
the originating chat or Bot Chat. A Release rebuild and the user's Always permission are required.

For an install that launches without Metro, use a Release build so Expo embeds the JavaScript
bundle: `npm run ios:standalone -- --device` (local iPhone) or `eas build --profile preview
--platform ios` (internal install). The `development` EAS profile is a development client and
intentionally shows the "No script URL provided" error when Metro is not running; start Metro with
`npx expo start --dev-client` for that profile. Do not use the development profile as the
standalone phone app.

## Notifications and the Live Activity while the app is closed

iOS and Android suspend the app (and its page) seconds after it leaves the screen, so the backend
takes over then (`scout_backend/push/`, wired from `tui_gateway/session_push.py` and the cron delivery):

- `src/push.ts` registers the phone at `POST /api/push/devices` (Expo push token, Apple's
  push-to-start token), reports presence every minute while on screen and on every app-state change,
  says which chat is open (`watching`), and maps each Live Activity to its chat with Apple's update
  token. The server answers with `delivers`: once its notifications get through, the phone stops
  posting its own copy while away (`notifyLocally`).
- Notifications go through Expo's push service (both platforms). They need the app's push keys
  uploaded to Expo (`eas credentials`: an APNs key for iOS, an FCM key for Android); until then the
  server logs `InvalidCredentials` and the phone keeps notifying from the page.
- Live Activity updates go straight to Apple: an APNs key at `<SCOUT_HOME>/push/apns-key.p8` plus
  `push.apns.team_id` / `key_id` in config.yaml. A push-started activity is named
  `scout:<chat id>` so the phone can tell whose token it is.
- A tapped notification carries `data.sessionId`; `ScoutScreen` dispatches `scout:focus-session`
  (or hands it over via `take-focus` when the tap launched the app) and the page opens that chat.

Test in the simulator: `xcrun simctl push <udid> com.spaceshipresearch.scout payload.json` with
`{"aps": {...}, "body": {"sessionId": "..."}}` (Expo puts `data` under `body`). The simulator gets a
real Expo token; Live Activity pushes need a device or Apple's push console.

## Expo changes every SDK — check the versioned docs

Read the `expo` major version in `package.json` and use `https://docs.expo.dev/versions/v<major>.0.0/`
(index: https://docs.expo.dev/llms.txt) before using an Expo or React Native API. Add native
modules with `npx expo install <pkg>` so versions match the SDK.
