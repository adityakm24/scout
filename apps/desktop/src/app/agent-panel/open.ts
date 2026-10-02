import { findGroupOfPane } from '@/components/pane-shell/tree/model'
import {
  $collapsedTreeSides,
  $layoutTree,
  paneRootSide,
  revealTreePane,
  setTreeGroupMinimized
} from '@/components/pane-shell/tree/store'

/** Pane id of the agent panel (registered in app/contrib/controller.tsx). */
export const AGENT_PANEL_ID = 'agent'

/** Show the agent panel: un-collapse its side, restore its zone and front its tab. */
export const openAgentPanel = () => revealTreePane(AGENT_PANEL_ID)

/** Is the agent panel on screen right now (its zone open, its tab in front, its side shown)? */
export function agentPanelShown(): boolean {
  const tree = $layoutTree.get()
  const group = tree ? findGroupOfPane(tree, AGENT_PANEL_ID) : null
  const side = paneRootSide(AGENT_PANEL_ID)

  return Boolean(
    group && !group.minimized && group.active === AGENT_PANEL_ID && !(side && $collapsedTreeSides.get().has(side))
  )
}

/** Fold the agent panel back to its rail (its close button). */
export function closeAgentPanel() {
  const tree = $layoutTree.get()
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
