import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { type ActivityUpdate, showActivity } from './activity'
import type { Pairing } from './pairing'
import { notifyLocally, setWatching, startPush } from './push'
import { colors } from './theme'

// Scout's own notices ("Ordered, arriving in 11 minutes") show as banners even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
})

/** Scout itself: the desktop renderer, served by the paired computer, with the phone's own
 *  abilities offered to it as `window.scoutNative`. */
export function ScoutScreen({ onUnpair, pairing }: { onUnpair: () => void; pairing: Pairing }) {
  const webview = useRef<WebView>(null)
  const [failed, setFailed] = useState('')

  // A chat whose notification was tapped before the page could listen (the tap launched the app).
  const pendingFocus = useRef<null | string>(null)

  // Ask once, while the user is here: iOS cannot show its permission prompt from the background,
  // which is exactly when Scout's replies and questions need to reach them. Then register this
  // phone, so the paired Scout can still reach it once the app is closed.
  useEffect(() => {
    let stop = () => undefined as void

    void Notifications.requestPermissionsAsync().finally(() => {
      stop = startPush(pairing)
    })

    return () => stop()
  }, [pairing])

  // A tapped notification opens its chat (the page's onFocusSession, src/platform/web-bridge.ts):
  // at once when the page is running, or once it asks, when the tap launched the app.
  useEffect(() => {
    pendingFocus.current = tappedChat(Notifications.getLastNotificationResponse())

    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const sessionId = tappedChat(response)

      if (sessionId) {
        webview.current?.injectJavaScript(
          `window.dispatchEvent(new CustomEvent('scout:focus-session', { detail: ${JSON.stringify(sessionId)} })); true;`
        )
      }
    })

    return () => subscription.remove()
  }, [])

  // Runs before the renderer's own scripts, so its web bridge finds the backend and token.
  const bootstrap = `
    window.__SCOUT_REMOTE__ = ${JSON.stringify(pairing)};
    (function () {
      // The page's own failures land in the dev server log (Metro), not an invisible console.
      function report(message) {
        try { window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'log', payload: String(message).slice(0, 2000) })); } catch (e) {}
      }
      window.addEventListener('error', function (e) { report('error: ' + (e.error && e.error.stack || e.message) + ' @ ' + e.filename + ':' + e.lineno); });
      window.addEventListener('unhandledrejection', function (e) { report('rejection: ' + (e.reason && e.reason.stack || e.reason)); });
      var consoleError = console.error;
      console.error = function () { report('console.error: ' + Array.prototype.join.call(arguments, ' ')); return consoleError.apply(console, arguments); };
    })();
    (function () {
      var pending = {}, next = 0;
      window.__scoutNativeReply = function (id, result, error) {
        var call = pending[id]; delete pending[id];
        if (call) error ? call.reject(new Error(error)) : call.resolve(result);
      };
      window.scoutNative = {
        platform: ${JSON.stringify(process.env.EXPO_OS ?? 'ios')},
        request: function (kind, payload) {
          return new Promise(function (resolve, reject) {
            var id = ++next; pending[id] = { resolve: resolve, reject: reject };
            window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, kind: kind, payload: payload }));
          });
        }
      };
    })();
    true;
  `

  const reply = (id: number, result: unknown, error?: string) =>
    webview.current?.injectJavaScript(
      `window.__scoutNativeReply(${id}, ${JSON.stringify(result ?? null)}, ${JSON.stringify(error ?? null)}); true;`
    )

  const onMessage = async (event: WebViewMessageEvent) => {
    let call: { id: number; kind: string; payload?: unknown }

    try {
      call = JSON.parse(event.nativeEvent.data)
    } catch {
      return
    }

    if (call.kind === 'log') {
      console.warn(`[scout page] ${String(call.payload)}`)

      return
    }

    try {
      reply(call.id, await handle(call.kind, call.payload))
    } catch (error) {
      reply(call.id, null, error instanceof Error ? error.message : String(error))
    }
  }

  const handle = async (kind: string, payload?: unknown): Promise<unknown> => {
    if (kind === 'activity') {
      await showActivity(payload as ActivityUpdate)

      return true
    }

    if (kind === 'notify') {
      const { body, sessionId, title } = (payload ?? {}) as { body?: string; sessionId?: string; title?: string }
      const { granted } = await Notifications.requestPermissionsAsync()

      if (!granted || !notifyLocally()) {
        return false
      }

      await Notifications.scheduleNotificationAsync({
        content: { body, data: sessionId ? { sessionId } : {}, title: title || 'Scout' },
        trigger: null
      })

      return true
    }

    if (kind === 'watch') {
      setWatching(String((payload as { sessionId?: string } | undefined)?.sessionId ?? ''))

      return true
    }

    // The page started listening for taps: hand it the one that launched the app, once.
    if (kind === 'take-focus') {
      const sessionId = pendingFocus.current
      pendingFocus.current = null

      return sessionId
    }

    if (kind === 'location') {
      const { granted } = await Location.requestForegroundPermissionsAsync()

      if (!granted) {
        throw new Error('Location permission was not given')
      }

      const { coords, timestamp } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })

      return { accuracy: coords.accuracy, latitude: coords.latitude, longitude: coords.longitude, timestamp }
    }

    if (kind === 'unpair') {
      onUnpair()

      return true
    }

    throw new Error(`Unknown request: ${kind}`)
  }

  if (failed) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.title}>Can’t reach Scout</Text>
        <Text style={styles.body}>
          {pairing.baseUrl} didn’t answer. Make sure Scout is running on your computer and this phone is on the same
          network.
        </Text>
        <Pressable onPress={() => setFailed('')} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
        <Pressable onPress={onUnpair}>
          <Text style={styles.link}>Connect to a different Scout</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  return (
    // Edge to edge: the page pads itself with the safe-area insets (apps/desktop/src/app/phone),
    // so its tab bar and headers blur under the home bar and notch like a native app's.
    <View style={styles.screen}>
      <WebView
        contentInsetAdjustmentBehavior="never"
        allowsBackForwardNavigationGestures={false}
        bounces={false}
        injectedJavaScriptBeforeContentLoaded={bootstrap}
        // The page scrolls inside its own panes; letting the web view scroll too makes iOS shove
        // the whole app up when the keyboard opens. And a page script never raises the keyboard
        // by itself (a chat opening must not), only a tap does.
        keyboardDisplayRequiresUserAction
        scrollEnabled={false}
        // No web form bar (previous/next/done) over the keyboard: native apps don't have one.
        hideKeyboardAccessoryView
        onError={({ nativeEvent }) => setFailed(nativeEvent.description || 'error')}
        onLoadEnd={() => console.log(`[scout page] loaded ${pairing.baseUrl}`)}
        // iOS may stop a backgrounded or memory-heavy web content process; bring the page back.
        onContentProcessDidTerminate={() => {
          console.warn('[scout page] web content process ended; reloading')
          webview.current?.reload()
        }}
        onMessage={onMessage}
        originWhitelist={[pairing.baseUrl]}
        ref={webview}
        source={{ uri: pairing.appUrl ?? pairing.baseUrl }}
        style={styles.web}
      />
    </View>
  )
}

function tappedChat(response: Notifications.NotificationResponse | null): null | string {
  const sessionId = response?.notification.request.content.data?.sessionId

  return typeof sessionId === 'string' && sessionId ? sessionId : null
}

const styles = StyleSheet.create({
  body: { color: colors.textSecondary, fontSize: 15, textAlign: 'center' },
  button: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  center: { alignItems: 'center', gap: 16, justifyContent: 'center', padding: 24 },
  link: { color: colors.accent, fontSize: 15 },
  screen: { backgroundColor: colors.background, flex: 1 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  web: { backgroundColor: colors.background, flex: 1 }
})
