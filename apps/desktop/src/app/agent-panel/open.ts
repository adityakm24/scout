import { atom } from 'nanostores'

import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { findGroupOfPane } from '@/components/pane-shell/tree/model'
import {
  $collapsedTreeSides,
  $layoutTree,
  $narrowViewport,
  paneRootSide,
  revealTreePane,
  setTreeGroupMinimized
} from '@/components/pane-shell/tree/store'
import { IS_PHONE } from '@/platform/phone'

/** Pane id of the agent panel (registered in app/contrib/controller.tsx). */
export const AGENT_PANEL_ID = 'agent'

export const $phoneAgentPanelOpen = atom(false)

/** Show the agent panel: un-collapse its side, restore its zone and front its tab. On a narrow
 *  window the side panes are unmounted and shown by the edge overlay instead, which opens on the
 *  reveal event (components/pane-shell/tree/renderer/narrow-overlays.tsx). */
export function openAgentPanel() {
  if (IS_PHONE) {
    $phoneAgentPanelOpen.set(true)
    document.documentElement.setAttribute('data-phone-agent-open', '')

    return
  }

  if ($narrowViewport.get()) {
    window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: AGENT_PANEL_ID, mode: 'open' } }))

    return
  }

  revealTreePane(AGENT_PANEL_ID)
}

/** Is the agent panel on screen right now (its zone open, its tab in front, its side shown)? */
export function agentPanelShown(): boolean {
  const tree = $layoutTree.get()
  const group = tree ? findGroupOfPane(tree, AGENT_PANEL_ID) : null
  const side = paneRootSide(AGENT_PANEL_ID)

  return Boolean(
    group && !group.minimized && group.active === AGENT_PANEL_ID && !(side && $collapsedTreeSides.get().has(side))
  )
}

/** Fold the agent panel back to its rail (its close button); on a narrow window, dismiss the
 *  edge overlay that shows it instead. */
export function closeAgentPanel() {
  const tree = $layoutTree.get()

  if (IS_PHONE) {
    $phoneAgentPanelOpen.set(false)
    document.documentElement.removeAttribute('data-phone-agent-open')

    return
  }

  if ($narrowViewport.get()) {
    window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: AGENT_PANEL_ID, mode: 'close' } }))

    return
  }

  const group = tree ? findGroupOfPane(tree, AGENT_PANEL_ID) : null

  if (group) {
    setTreeGroupMinimized(group.id, true)
  }
}

/** The titlebar's right-panel button: open the agent panel, or fold it back to its rail.
 *  False when the layout has no agent panel (a preset dropped it), so the caller falls back. */
export function toggleAgentPanel(): boolean {
  const tree = $layoutTree.get()
  const group = tree ? findGroupOfPane(tree, AGENT_PANEL_ID) : null

  if (!group) {
    return false
  }

  if (agentPanelShown()) {
    closeAgentPanel()
  } else {
    openAgentPanel()
  }

  return true
}

// Below this the chat stops being readable (a few words a line, a clipped composer).
const MIN_CHAT_PX = 320

function chatWidth(): number {
  return Math.max(0, ...[...document.querySelectorAll<HTMLElement>('[data-chat-surface]')].map(el => el.clientWidth))
}

let roomWatchStarted = false

/** Keep the chat usable on a narrow window: when the agent panel leaves the chat less than
 *  MIN_CHAT_PX, fold the panel to its rail. Checked at launch (a panel restored open into a small
 *  window) and as the window shrinks, never when the user opens the panel themselves. */
export function startAgentPanelRoomWatch() {
  // On a phone the panel is a full screen sheet over the chat (app/phone/phone.css), never beside it.
  if (roomWatchStarted || IS_PHONE) {
    return
  }

  roomWatchStarted = true

  let frame = 0

  const check = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const width = chatWidth()

      if (width > 0 && width < MIN_CHAT_PX && agentPanelShown()) {
        closeAgentPanel()
      }
    })
  }

  window.addEventListener('resize', check)
  // The layout restores after the first paint; check once it has settled.
  window.setTimeout(check, 1500)
}
