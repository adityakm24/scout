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

const EDITABLE_SELECTOR =
  'input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'

function targetElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : ((target as Node | null)?.parentElement ?? null)
}

export function isPhoneEditableTarget(target: EventTarget | null): boolean {
  const el = targetElement(target)

  return Boolean(el && ((el as HTMLElement).isContentEditable || el.closest(EDITABLE_SELECTOR)))
}

/** Block desktop right-click menus on a phone while keeping iOS's native Copy / Paste callout
 *  inside text fields. Stopping propagation even on text fields prevents ancestor Radix context
 *  menus (such as ZoneMenu wrapping the pane body) from opening over the composer. */
export function suppressPhoneContextMenu(event: Event): void {
  if (!isPhoneEditableTarget(event.target)) {
    event.preventDefault()
  }

  event.stopPropagation()
}

/** Dismiss the software keyboard when the user drags to scroll outside the composer or focused
 *  input. Because the outer WebView disables its own scroll view and panes scroll inner DOM
 *  containers, iOS's native UIScrollView keyboardDismissMode does not fire automatically. */
export function installPhoneScrollKeyboardDismiss(root: Window | Document = window): () => void {
  let touchStart: { x: number; y: number } | null = null

  const blurActiveEditable = () => {
    const active = document.activeElement

    if (active instanceof HTMLElement && isPhoneEditableTarget(active)) {
      active.blur()
    }
  }

  const onTouchStart = (event: Event) => {
    const touchEvent = event as TouchEvent

    if (touchEvent.touches.length !== 1) {
      touchStart = null

      return
    }

    const el = targetElement(touchEvent.target)

    if (el?.closest('[data-slot="composer-dock"]') || isPhoneEditableTarget(touchEvent.target)) {
      touchStart = null

      return
    }

    const touch = touchEvent.touches[0]
    touchStart = { x: touch.clientX, y: touch.clientY }
  }

  const onTouchMove = (event: Event) => {
    if (!touchStart) {
      return
    }

    const touchEvent = event as TouchEvent

    if (touchEvent.touches.length !== 1) {
      touchStart = null

      return
    }

    const touch = touchEvent.touches[0]
    const dx = touch.clientX - touchStart.x
    const dy = touch.clientY - touchStart.y

    if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
      touchStart = null
      blurActiveEditable()
    }
  }

  const onScroll = (event: Event) => {
    if (!touchStart) {
      return
    }

    const el = targetElement(event.target)

    if (el?.closest('[data-slot="composer-dock"]') || isPhoneEditableTarget(event.target)) {
      return
    }

    touchStart = null
    blurActiveEditable()
  }

  const clearTouch = () => {
    touchStart = null
  }

  root.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
  root.addEventListener('touchmove', onTouchMove, { capture: true, passive: true })
  root.addEventListener('scroll', onScroll, { capture: true, passive: true })
  root.addEventListener('touchend', clearTouch, { capture: true, passive: true })
  root.addEventListener('touchcancel', clearTouch, { capture: true, passive: true })

  return () => {
    root.removeEventListener('touchstart', onTouchStart, true)
    root.removeEventListener('touchmove', onTouchMove, true)
    root.removeEventListener('scroll', onScroll, true)
    root.removeEventListener('touchend', clearTouch, true)
    root.removeEventListener('touchcancel', clearTouch, true)
  }
}

if (IS_PHONE) {
  document.documentElement.dataset.phone = ''
  // Edge to edge under the notch and home bar (safe-area insets do the spacing); no
  // pinch-zoom or double-tap zoom on an app surface.
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
  trackVisibleViewport()
  installPhoneScrollKeyboardDismiss()
  window.addEventListener('contextmenu', suppressPhoneContextMenu, true)
}

/** Size the app to what is visible: above the keyboard while it is open, so the composer rides
 *  on top of it and the headers stay put (iOS otherwise scrolls the whole page under the notch). */
function trackVisibleViewport() {
  const viewport = window.visualViewport

  if (!viewport) {
    return
  }

  const fit = () => {
    const root = document.documentElement
    root.style.setProperty('--phone-viewport-height', `${Math.round(viewport.height)}px`)
    // With the keyboard up the home bar is covered, so nothing needs to clear it.
    root.toggleAttribute('data-phone-keyboard', window.innerHeight - viewport.height > 120)
    window.scrollTo(0, 0)
  }

  viewport.addEventListener('resize', fit)
  viewport.addEventListener('scroll', () => window.scrollTo(0, 0))
  fit()
}
