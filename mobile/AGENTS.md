# Scout mobile shell (Expo, iOS + Android)

The phone app is a thin native shell around the **desktop renderer** (`apps/desktop/src`), so every
desktop feature exists on the phone without a second UI. Do not rebuild desktop surfaces here.

- `src/ScoutScreen.tsx` hosts the renderer in a WebView. Before the page's scripts run it sets
  `window.__SCOUT_REMOTE__ = { baseUrl, token }`, which `apps/desktop/src/platform/web-bridge.ts`
  turns into the `window.scoutDesktop` bridge Electron's preload normally provides.
- Phone-only abilities are offered to the page as `window.scoutNative.request(kind, payload)`
  (handled in `ScoutScreen.handle`): `location`, `unpair`. Add a kind there, not a new channel.
- Pairing (`src/pairing.ts`) is one link — the renderer's address with `?token=` — scanned as a QR
  or pasted; it is kept in the OS keychain (expo-secure-store), never in plain storage.
- Lives outside the root npm workspaces on purpose (its own lockfile): React Native pins a
  React version independent of the desktop's.

Dev loop: serve the renderer on the LAN from `apps/desktop` (`npx vite --host 0.0.0.0 --port 5175`;
it proxies `/api` to the backend), run `npx expo start --lan` here, open it in Expo Go.
Background location and geofencing need a development build (not Expo Go).

## Expo changes every SDK — check the versioned docs

Read the `expo` major version in `package.json` and use `https://docs.expo.dev/versions/v<major>.0.0/`
(index: https://docs.expo.dev/llms.txt) before using an Expo or React Native API. Add native
modules with `npx expo install <pkg>` so versions match the SDK.
