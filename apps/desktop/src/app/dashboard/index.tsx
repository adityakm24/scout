import { useStore } from '@nanostores/react'
import { type CSSProperties, useEffect, useState } from 'react'

import { dayPart } from '@/components/chat/intro'
import { useI18n } from '@/i18n'
import { $openTodoCount, $plannerStatus, $upcomingReminders, refreshPlanner } from '@/store/planner'

import { ReminderPanel } from './reminder-panel'
import { TodoPanel } from './todo-panel'

const fmtToday = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

/**
 * The Dashboard: the user's to-dos (left) and reminders (right), the same
 * store the agent's `planner` tool reads and writes. Everything here is live —
 * an edit from the agent, the CLI or another window repaints it through
 * `planner.changed` / `cron.changed` (store/planner.ts).
 */
export function DashboardPage() {
  const { t } = useI18n()
  const status = useStore($plannerStatus)
  const openCount = useStore($openTodoCount)
  const upcoming = useStore($upcomingReminders)
  const [part] = useState(() => dayPart(new Date().getHours()))

  // Mounting is the user opening the page: take a fresh read rather than trust
  // a list another profile's socket may have left behind.
  useEffect(() => {
    void refreshPlanner()
  }, [])

  return (
    <section
      aria-label={t.dashboard.title}
      // Columns follow the room the page has, not the window: beside the sidebar and the agent
      // panel a wide window leaves a narrow page, and two columns there squeezed every row.
      className="@container/dash relative isolate flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden"
      data-slot="dashboard-page"
    >
      <div aria-hidden="true" className="scout-sky -z-10" />
      <div className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col px-6 pb-8 pt-10 @[40rem]/dash:px-10">
        <header className="scout-rise mb-7" style={{ '--rise-index': 0 } as CSSProperties}>
          <p className="m-0 text-[0.8125rem] font-semibold text-(--dt-midground)">{fmtToday.format(new Date())}</p>
          <h1 className="scout-greeting scout-greeting--page m-0 mt-1">{t.intro.greeting[part]}</h1>
          <p className="m-0 mt-2 text-[0.9375rem] text-(--ui-text-secondary)">
            {status === 'unsupported' ? t.dashboard.unsupported : t.dashboard.greetingLine(openCount, upcoming.length)}
          </p>
        </header>

        {status !== 'unsupported' && (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 @[52rem]/dash:grid-cols-2 [&>section]:min-h-[26rem]">
            <TodoPanel />
            <ReminderPanel />
          </div>
        )}
      </div>
    </section>
  )
}
