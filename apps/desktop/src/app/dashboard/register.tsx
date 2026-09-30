import { lazy, Suspense } from 'react'

import { PALETTE_AREA, type PaletteContribution } from '@/app/command-palette/contrib'
import { type RouteContribution, ROUTES_AREA } from '@/app/routes'
import { IdleMount } from '@/components/idle-mount'
import { registry } from '@/contrib/registry'
import { LocalizedTabTitle, translateNow } from '@/i18n'
import { startPlannerSync } from '@/store/planner'

import { DASHBOARD_PANE_ID, DASHBOARD_ROUTE, leaveDashboardPage, openDashboard } from './nav'

const DashboardPage = lazy(async () => ({ default: (await import('.')).DashboardPage }))
const DashboardSidebarPane = lazy(async () => ({ default: (await import('./sidebar-pane')).DashboardSidebarPane }))

/**
 * The Dashboard: a core page at `/dashboard` plus a third tab in the sidebar's
 * SESSIONS | BOTS strip (docked into the sessions zone the same way Bots is),
 * and a palette row. Planner sync starts here — not in a mounted view — so a
 * fired reminder notifies even while the Dashboard is closed.
 */
export function registerDashboard(): void {
  startPlannerSync()

  registry.registerMany([
    {
      id: 'dashboard.page',
      area: ROUTES_AREA,
      title: translateNow('dashboard.title'),
      data: { path: DASHBOARD_ROUTE } satisfies RouteContribution,
      render: () => <DashboardPage />
    },
    {
      id: DASHBOARD_PANE_ID,
      area: 'panes',
      title: translateNow('dashboard.title'),
      data: {
        placement: 'left',
        collapsible: true,
        hideOnly: true,
        width: '260px',
        tabTitle: () => <LocalizedTabTitle select={t => t.dashboard.title} />,
        tabTitleText: () => translateNow('dashboard.title'),
        // Center-stack into the sessions zone: the strip reads
        // SESSIONS | BOTS | DASHBOARD. `enforce` re-homes it there at every
        // boot, like Bots, so a stale persisted layout can't strand it.
        dock: { pane: 'sessions', pos: 'center', enforce: true },
        // The tab mirrors the page: reaching /dashboard any other way (palette,
        // a reminder notification) fronts it; leaving hands it back to Sessions.
        route: DASHBOARD_ROUTE,
        // Choosing the tab (click / keyboard) opens the full page; choosing
        // Sessions or Bots over it takes the workspace back to the chat.
        onActivate: openDashboard,
        onDeactivate: leaveDashboardPage
      },
      render: () => (
        <IdleMount>
          <Suspense fallback={null}>
            <DashboardSidebarPane />
          </Suspense>
        </IdleMount>
      )
    },
    {
      id: 'dashboard.open',
      area: PALETTE_AREA,
      data: {
        id: 'dashboard.open',
        label: translateNow('dashboard.openDashboard'),
        keywords: ['dashboard', 'todo', 'to-do', 'tasks', 'reminders', 'planner'],
        run: openDashboard
      } satisfies PaletteContribution
    }
  ])
}
