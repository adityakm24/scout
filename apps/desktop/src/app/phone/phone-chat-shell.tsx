import { WiredPane } from '@/app/contrib/context'

/** Phone chat: one full-width surface — no layout tree, splits, or side panes. */
export function PhoneWorkspaceShell() {
  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-phone-workspace-shell=""
    >
      <WiredPane part="chatRoutes" />
    </div>
  )
}
