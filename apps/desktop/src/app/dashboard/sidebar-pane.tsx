import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { Bell, Check, LayoutDashboard, Plus } from '@/lib/icons'
import { fmtDayTime, relativeTime } from '@/lib/time'
import { $openTodoCount, $plannerTodos, $upcomingReminders, addTodo, toggleTodo } from '@/store/planner'

import { openDashboard } from './nav'

const PREVIEW_COUNT = 6

/**
 * The Dashboard tab beside Sessions and Bots: a glanceable summary (open
 * to-dos you can tick off, the next reminder, a quick-add), and the door to
 * the full page. Choosing the tab opens the page too (the pane's `onActivate`,
 * register.tsx) — only on the user's choice, never on a restored layout.
 */
export function DashboardSidebarPane() {
  const { t } = useI18n()

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-3 pb-3 pt-2">
      <SummaryTiles />
      <QuickAdd />
      <OpenTodos />
      <Button className="mt-auto h-9 rounded-full text-[0.8125rem]" onClick={openDashboard} variant="secondary">
        <LayoutDashboard className="size-4" />
        {t.dashboard.openDashboard}
      </Button>
    </div>
  )
}

function SummaryTiles() {
  const { t } = useI18n()
  const openCount = useStore($openTodoCount)
  const upcoming = useStore($upcomingReminders)
  const next = upcoming[0]
  const nextAt = next?.next_at ? new Date(next.next_at).getTime() : null

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        className="rounded-2xl bg-(--ui-bg-quaternary) p-3 text-left transition-colors hover:bg-(--chrome-action-hover)"
        data-slot="button"
        onClick={openDashboard}
        type="button"
      >
        <Check className="size-4 text-(--dt-midground)" />
        <p className="m-0 mt-2 text-[1.375rem] font-semibold leading-none tracking-[-0.02em] tabular-nums">{openCount}</p>
        <p className="m-0 mt-1 text-[0.6875rem] text-(--ui-text-tertiary)">{t.dashboard.todos.title}</p>
      </button>
      <button
        className="min-w-0 rounded-2xl bg-(--ui-bg-quaternary) p-3 text-left transition-colors hover:bg-(--chrome-action-hover)"
        data-slot="button"
        onClick={openDashboard}
        type="button"
      >
        <Bell className="size-4 text-(--dt-midground)" />
        <p className="m-0 mt-2 truncate text-[0.8125rem] font-semibold leading-tight">
          {next ? next.text : t.dashboard.sidebar.nothingNext}
        </p>
        <p className="m-0 mt-1 truncate text-[0.6875rem] text-(--ui-text-tertiary)">
          {nextAt
            ? Math.abs(nextAt - Date.now()) < 86_400_000
              ? relativeTime(nextAt)
              : fmtDayTime.format(nextAt)
            : t.dashboard.sidebar.nextReminder}
        </p>
      </button>
    </div>
  )
}

function QuickAdd() {
  const { t } = useI18n()
  const [title, setTitle] = useState('')

  const submit = () => {
    const text = title.trim()

    if (text) {
      setTitle('')
      void addTodo(text)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-xl bg-(--ui-bg-quaternary) px-2.5 py-1.5 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--dt-midground)_16%,transparent)]">
      <Plus className="size-3.5 shrink-0 text-(--ui-text-tertiary)" />
      <input
        aria-label={t.dashboard.sidebar.quickAdd}
        className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-foreground outline-none placeholder:text-(--ui-text-tertiary)"
        onChange={event => setTitle(event.target.value)}
        onKeyDown={event => event.key === 'Enter' && submit()}
        placeholder={t.dashboard.sidebar.quickAdd}
        value={title}
      />
    </div>
  )
}

function OpenTodos() {
  const { t } = useI18n()
  const todos = useStore($plannerTodos).filter(todo => todo.status !== 'done').slice(0, PREVIEW_COUNT)

  if (todos.length === 0) {
    return null
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {todos.map(todo => (
        <li className="scout-row-enter flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-(--chrome-action-hover)" key={todo.id}>
          <button
            aria-label={t.dashboard.todos.markDone}
            className="scout-check scout-check--sm"
            data-checked={false}
            data-priority={todo.priority ?? 'none'}
            onClick={() => void toggleTodo(todo)}
            type="button"
          />
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-foreground">{todo.title}</span>
        </li>
      ))}
    </ul>
  )
}
