import { NEW_CHAT_ROUTE, routePathname, sessionRoute, syncWorkspaceRoute } from '@/app/routes'
import { $selectedStoredSessionId } from '@/store/session'

export const DASHBOARD_ROUTE = '/dashboard'
export const DASHBOARD_PANE_ID = 'dashboard'

function go(to: string): void {
  window.location.hash = `#${to}`
  syncWorkspaceRoute(to)
}

/** Show the Dashboard page in the workspace (the same path `host.navigate` takes). */
export function openDashboard(): void {
  go(DASHBOARD_ROUTE)
}

/** The user left the Dashboard tab for Sessions/Bots: put the workspace back on
 *  the chat they had selected (or a fresh one) — but only if the page is still
 *  what's showing, never pulling them off a page they navigated to since. */
export function leaveDashboardPage(): void {
  if (routePathname(window.location.hash.replace(/^#/, '')) !== DASHBOARD_ROUTE) {
    return
  }

  const selected = $selectedStoredSessionId.get()
  go(selected ? sessionRoute(selected) : NEW_CHAT_ROUTE)
}
