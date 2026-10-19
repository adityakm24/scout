# Scout mobile shell (Expo, iOS + Android)

The phone app is a thin native shell around the **desktop renderer** (`apps/desktop/src`), so every
desktop feature exists on the phone without a second UI. Do not rebuild desktop surfaces here.

- `src/ScoutScreen.tsx` hosts the renderer in a WebView. Before the page's scripts run it sets
  `window.__SCOUT_REMOTE__ = { baseUrl, token }`, which `apps/desktop/src/platform/web-bridge.ts`
  turns into the `window.scoutDesktop` bridge Electron's preload normally provides.
- Phone-only abilities are offered to the page as `window.scoutNative.request(kind, payload)`
  (handled in `ScoutScreen.handle`): `location`, `notify`, `activity`, `watch`, `take-focus`,
  `unpair`. Add a kind there, not a new channel.
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
