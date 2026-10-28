import { AGENT_PANEL_ID, closeAgentPanel } from '@/app/agent-panel/open'
import { registry } from '@/contrib/registry'
import { allPaneIds, findGroupOfPane, group } from '@/components/pane-shell/tree/model'
import {
  activateTreePane,
  $layoutTree,
  dismissTreePane,
  persistTree,
  treePanesWithPrefix
} from '@/components/pane-shell/tree/store'
import { IS_PHONE } from '@/platform/phone'
import { resetPhonePreviewShell } from '@/store/preview'

const PHONE_MAIN_PANE = 'workspace'

/** One chat column — no desktop splits persisted on the phone WebView. */
const PHONE_TREE = group(['workspace'], { id: 'grp-phone-main' })

const LAYOUT_STORAGE_KEYS = [
  'scout.desktop.layoutTree.v2',
  'scout.desktop.layoutTree.v2.simple',
  'scout.desktop.dismissedPanes.v1',
  'scout.desktop.dismissedPanes.v1.simple',
  'scout.desktop.paneShare.v1',
  'scout.desktop.paneShare.v1.simple',
  'scout.desktop.previewTabs.v2'
] as const

function clearPhoneLayoutStorage(): void {
  for (const key of LAYOUT_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* WebView private mode */
    }
  }
}

function focusPhoneChat(): void {
  document.documentElement.removeAttribute('data-phone-agent-open')
  closeAgentPanel()

  const tree = $layoutTree.get()
  const chatGroup = tree ? findGroupOfPane(tree, PHONE_MAIN_PANE) : null

  if (chatGroup) {
    activateTreePane(chatGroup.id, PHONE_MAIN_PANE, { byUser: false })
  }
}

function dismissNonChatPanes(): void {
  for (const contribution of registry.getArea('panes')) {
    if (contribution.id !== PHONE_MAIN_PANE) {
      dismissTreePane(contribution.id)
    }
  }

  for (const paneId of treePanesWithPrefix('preview-tile:')) {
    dismissTreePane(paneId)
  }

  for (const paneId of treePanesWithPrefix('route-tile:')) {
    dismissTreePane(paneId)
  }

  for (const paneId of treePanesWithPrefix('session-tile:')) {
    dismissTreePane(paneId)
  }

  const tree = $layoutTree.get()

  if (tree) {
    for (const paneId of allPaneIds(tree)) {
      if (paneId !== PHONE_MAIN_PANE) {
        dismissTreePane(paneId)
      }
    }
  }
}

function applyPhoneTree(): void {
  $layoutTree.set(PHONE_TREE)
  persistTree()
  focusPhoneChat()
}

/** Phone is chat-first: no desktop splits, preview/browser panes, or side rails. */
export function resetPhoneLayoutShell(): void {
  if (!IS_PHONE) {
    return
  }

  resetPhonePreviewShell()
  dismissNonChatPanes()
  applyPhoneTree()
}

/** Clear stale layout storage when the deploy id changes (no forced reload — WebView cache is handled separately). */
export function runPhoneDeployRefresh(): void {
  if (!IS_PHONE || typeof window === 'undefined') {
    return
  }

  const DEPLOY = '20261027-phone-chat-v4'

  try {
    if (localStorage.getItem('scout.phone.deployRev') !== DEPLOY) {
      localStorage.setItem('scout.phone.deployRev', DEPLOY)
      clearPhoneLayoutStorage()
    }
  } catch {
    /* ignore */
  }

  resetPhoneLayoutShell()
}
