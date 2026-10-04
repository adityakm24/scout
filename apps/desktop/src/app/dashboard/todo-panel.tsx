import { useStore } from '@nanostores/react'
import { type KeyboardEvent, useMemo, useState } from 'react'

import { ScoutOrb } from '@/components/chat/scout-orb'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { Check, ChevronDown, Flag, FlagFilled, MoreHorizontal, Plus, Trash2 } from '@/lib/icons'
import { fmtDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  $plannerTodos,
  addTodo,
  clearCompletedTodos,
  deleteTodo,
  type PlannerPriority,
  type PlannerTodo,
  toggleTodo,
  updateTodo
} from '@/store/planner'

import { dueInputValue, dueKind, parseLocalDateTime } from './time'

const PRIORITIES: readonly PlannerPriority[] = ['high', 'medium', 'low', 'none']

const PRIORITY_FLAG: Record<PlannerPriority, string> = {
  high: 'text-[#ff453a]',
  medium: 'text-[#ff9f0a]',
  low: 'text-[#0a84ff]',
  none: 'text-(--ui-text-tertiary)'
}

const PRIORITY_DOT: Record<PlannerPriority, string> = {
  high: 'bg-[#ff453a]',
  medium: 'bg-[#ff9f0a]',
  low: 'bg-[#0a84ff]',
  none: 'bg-(--ui-stroke-secondary)'
}

export function TodoPanel() {
  const todos = useStore($plannerTodos)
  const { t } = useI18n()
  const c = t.dashboard.todos
  const [showDone, setShowDone] = useState(false)
  const open = useMemo(() => todos.filter(todo => todo.status !== 'done'), [todos])
  const done = useMemo(() => todos.filter(todo => todo.status === 'done'), [todos])

  return (
    <section aria-label={c.title} className="scout-panel scout-rise" style={{ '--rise-index': 1 } as React.CSSProperties}>
      <PanelHeader count={open.length} icon={<Check className="size-4" />} title={c.title} />
      <TodoComposer />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 @max-[52rem]/dash:overflow-visible">
        {open.length === 0 ? (
          <EmptyState body={c.empty} title={c.emptyTitle} />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {open.map(todo => (
              <TodoRow key={todo.id} todo={todo} />
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <div className="mt-3 border-t border-(--ui-stroke-tertiary) pt-2">
            <div className="flex items-center justify-between px-2">
              <button
                className="flex items-center gap-1 rounded-md py-1 text-[0.75rem] font-semibold text-(--ui-text-tertiary) hover:text-foreground"
                onClick={() => setShowDone(value => !value)}
                type="button"
              >
                <ChevronDown
                  className={cn('size-3.5 transition-transform duration-200 ease-out-quint', !showDone && '-rotate-90')}
                />
                {c.completed(done.length)}
              </button>
              {showDone && (
                <Button onClick={() => void clearCompletedTodos()} size="xs" variant="ghost">
                  {c.clearCompleted}
                </Button>
              )}
            </div>
            {showDone && (
              <ul className="mt-1 flex flex-col gap-0.5">
                {done.map(todo => (
                  <TodoRow key={todo.id} todo={todo} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export function PanelHeader({ count, icon, title }: { count?: number; icon: React.ReactNode; title: string }) {
  return (
    <header className="flex items-center gap-2.5 px-5 pb-2 pt-4">
      <span className="grid size-7 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--dt-midground)_14%,transparent)] text-(--dt-midground)">
        {icon}
      </span>
      <h2 className="m-0 text-[1.0625rem] font-semibold tracking-[-0.015em] text-foreground">{title}</h2>
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-(--ui-bg-quaternary) px-2 py-0.5 text-[0.6875rem] font-semibold tabular-nums text-(--ui-text-secondary)">
          {count}
        </span>
      )}
    </header>
  )
}

export function EmptyState({ body, title }: { body: string; title: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <ScoutOrb className="scout-orb--sm mb-4 opacity-80" />
      <p className="m-0 text-[0.9375rem] font-semibold text-foreground">{title}</p>
      <p className="m-0 mt-1 max-w-[18rem] text-[0.8125rem] leading-relaxed text-(--ui-text-tertiary)">{body}</p>
    </div>
  )
}

function TodoComposer() {
  const { t } = useI18n()
  const c = t.dashboard.todos
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState<PlannerPriority>('none')

  const submit = () => {
    const text = title.trim()

    if (!text) {
      return
    }

    setTitle('')
    setDue('')
    setPriority('none')
    void addTodo(text, { due: due || undefined, priority })
  }

  return (
    <div className="mx-3 mb-2 flex items-center gap-1.5 rounded-2xl bg-(--ui-bg-quaternary) py-1.5 pl-3 pr-1.5 transition-shadow duration-200 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--dt-midground)_16%,transparent)]">
      <Plus className="size-4 shrink-0 text-(--ui-text-tertiary)" />
      <input
        aria-label={c.addPlaceholder}
        className="min-w-0 flex-1 bg-transparent text-[0.875rem] text-foreground outline-none placeholder:text-(--ui-text-tertiary)"
        onChange={event => setTitle(event.target.value)}
        onKeyDown={event => event.key === 'Enter' && submit()}
        placeholder={c.addPlaceholder}
        value={title}
      />
      <DueField onChange={setDue} value={due} />
      <PriorityMenu onChange={setPriority} value={priority} />
      <Button className="h-7 rounded-full px-3.5 text-[0.75rem]" disabled={!title.trim()} onClick={submit} size="xs">
        {c.add}
      </Button>
    </div>
  )
}

function DueField({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  const { t } = useI18n()

  return (
    <label
      className={cn(
        'relative flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-[0.75rem] transition-colors',
        value ? 'bg-(--ui-bg-tertiary) text-foreground' : 'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)'
      )}
      title={t.dashboard.todos.due}
    >
      <Codicon name="calendar" />
      {value && <span className="tabular-nums">{fmtDate.format(parseLocalDateTime(`${value}T00:00`) ?? new Date())}</span>}
      <input
        aria-label={t.dashboard.todos.due}
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={event => onChange(event.target.value)}
        type="date"
        value={value}
      />
    </label>
  )
}

function PriorityMenu({ onChange, value }: { onChange: (value: PlannerPriority) => void; value: PlannerPriority }) {
  const { t } = useI18n()
  const c = t.dashboard.todos

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={value === 'none' ? c.priority : `${c.priority}: ${c.priorities[value]}`}
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full hover:bg-(--chrome-action-hover)',
          PRIORITY_FLAG[value]
        )}
        title={value === 'none' ? c.priority : `${c.priority}: ${c.priorities[value]}`}
      >
        {value === 'none' ? <Flag className="size-4" /> : <FlagFilled className="size-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{c.priority}</DropdownMenuLabel>
        <DropdownMenuRadioGroup onValueChange={next => onChange(next as PlannerPriority)} value={value}>
          {PRIORITIES.map(p => (
            <DropdownMenuRadioItem key={p} value={p}>
              <span className={cn('mr-2 size-2 rounded-full', PRIORITY_DOT[p])} />
              {c.priorities[p]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DueChip({ due }: { due: string }) {
  const { t } = useI18n()
  const c = t.dashboard.todos
  const kind = dueKind(due, new Date())
  const at = /^\d{4}-\d{2}-\d{2}$/.test(due) ? parseLocalDateTime(`${due}T00:00`) : new Date(due)
  const label = { overdue: c.overdue, today: c.today, tomorrow: c.tomorrow, later: at ? fmtDate.format(at) : due }[kind]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[0.6875rem] font-medium',
        kind === 'overdue' && 'bg-[color-mix(in_srgb,#ff453a_14%,transparent)] text-[#e0352b] dark:text-[#ff6961]',
        kind === 'today' && 'bg-[color-mix(in_srgb,var(--dt-midground)_14%,transparent)] text-(--dt-midground)',
        (kind === 'tomorrow' || kind === 'later') && 'bg-(--ui-bg-quaternary) text-(--ui-text-secondary)'
      )}
    >
      <Codicon name="calendar" />
      {label}
    </span>
  )
}

function TodoRow({ todo }: { todo: PlannerTodo }) {
  const { t } = useI18n()
  const c = t.dashboard.todos
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(todo.title)
  const doneState = todo.status === 'done'
  const priority = (todo.priority ?? 'none') as PlannerPriority

  const commit = () => {
    setEditing(false)
    const next = draft.trim()

    if (next && next !== todo.title) {
      void updateTodo(todo.id, { title: next })
    } else {
      setDraft(todo.title)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commit()
    } else if (event.key === 'Escape') {
      setDraft(todo.title)
      setEditing(false)
    }
  }

  return (
    <li className="scout-row-enter group/todo flex items-start gap-3 rounded-xl px-2 py-2 transition-colors duration-150 hover:bg-(--chrome-action-hover)">
      <button
        aria-label={doneState ? c.markOpen : c.markDone}
        className="scout-check mt-0.5"
        data-checked={doneState}
        data-priority={priority}
        onClick={() => void toggleTodo(todo)}
        type="button"
      >
        {doneState && <Check className="size-3" strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            className="w-full bg-transparent text-[0.875rem] text-foreground outline-none"
            onBlur={commit}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            value={draft}
          />
        ) : (
          <button
            className={cn(
              'block w-full cursor-text text-left text-[0.875rem] leading-snug transition-colors duration-300',
              doneState ? 'text-(--ui-text-tertiary) line-through decoration-(--ui-text-quaternary)' : 'text-foreground'
            )}
            onClick={() => {
              setDraft(todo.title)
              setEditing(true)
            }}
            type="button"
          >
            {todo.title}
          </button>
        )}
        {(todo.due || todo.created_by === 'agent' || todo.notes) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {todo.due && !doneState && <DueChip due={todo.due} />}
            {todo.created_by === 'agent' && (
              <span className="inline-flex items-center gap-1 text-[0.6875rem] text-(--ui-text-tertiary)">
                <ScoutOrb className="scout-orb--mini" />
                {c.byScout}
              </span>
            )}
            {todo.notes && <span className="truncate text-[0.75rem] text-(--ui-text-tertiary)">{todo.notes}</span>}
          </div>
        )}
      </div>

      <TodoActions todo={todo} />
    </li>
  )
}

function TodoActions({ todo }: { todo: PlannerTodo }) {
  const { t } = useI18n()
  const c = t.dashboard.todos

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={c.priority}
        className="grid size-7 shrink-0 place-items-center rounded-lg text-(--ui-text-tertiary) opacity-0 transition-opacity hover:bg-(--chrome-action-hover) hover:text-foreground focus-visible:opacity-100 group-hover/todo:opacity-100 data-[state=open]:opacity-100"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>{c.priority}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={next => void updateTodo(todo.id, { priority: next as PlannerPriority })}
          value={todo.priority ?? 'none'}
        >
          {PRIORITIES.map(p => (
            <DropdownMenuRadioItem key={p} value={p}>
              <span className={cn('mr-2 size-2 rounded-full', PRIORITY_DOT[p])} />
              {c.priorities[p]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{c.due}</DropdownMenuLabel>
        <div className="px-2 pb-1.5">
          <input
            aria-label={c.due}
            className="w-full rounded-md bg-(--ui-bg-quaternary) px-2 py-1 text-[0.8125rem] text-foreground outline-none"
            defaultValue={dueInputValue(todo.due)}
            onChange={event => void updateTodo(todo.id, { due: event.target.value })}
            type="date"
          />
        </div>
        {todo.due && <DropdownMenuItem onSelect={() => void updateTodo(todo.id, { due: '' })}>{c.clearDue}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void deleteTodo(todo.id)} variant="destructive">
          <Trash2 className="size-4" />
          {c.delete}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
