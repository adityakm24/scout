// Phone mode: the renderer hosted by the phone app (mobile/), or opened in a phone browser.
// The desktop layout stays the source of every surface; phone mode swaps only the chrome
// around them (src/app/phone/) for a native tab bar, a chats list and a conversation header.

declare global {
  interface Window {
    /** The phone shell's abilities (mobile/src/ScoutScreen.tsx). */
    scoutNative?: {
      platform: string
      request: <T = unknown>(kind: string, payload?: unknown) => Promise<T>
    }
  }
}

function detectPhone(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  if (window.scoutNative) {
    return true
  }

  // A phone browser: no Electron bridge of its own, a touch screen, a phone-sized display.
  const outsideElectron = (window.scoutDesktop as { platform?: string } | undefined)?.platform === 'web'

  return (
    outsideElectron &&
    window.matchMedia('(pointer: coarse)').matches &&
    Math.min(window.screen.width, window.screen.height) < 600
  )
}

export const IS_PHONE = detectPhone()

if (IS_PHONE) {
  document.documentElement.dataset.phone = ''
  // Edge to edge under the notch and home bar (safe-area insets do the spacing); no
  // pinch-zoom or double-tap zoom on an app surface.
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
}
