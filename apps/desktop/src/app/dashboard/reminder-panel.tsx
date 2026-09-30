import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { ScoutOrb } from '@/components/chat/scout-orb'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { Bell, ChevronDown, Clock, Trash2 } from '@/lib/icons'
import { DAY, fmtDayTime, relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  $plannerReminders,
  addReminder,
  clearFiredReminders,
  deleteReminder,
  type PlannerReminder,
  updateReminder
} from '@/store/planner'

import {
  isRelativePreset,
  nextWholeHour,
  parseLocalDateTime,
  presetSchedule,
  REMINDER_PRESETS,
  REMINDER_REPEATS,
  type ReminderPreset,
  type ReminderRepeat,
  scheduleFor,
  toLocalDateTimeValue
} from './time'
import { EmptyState, PanelHeader } from './todo-panel'

/** Re-render every `ms` so relative labels ("in 12 min") keep moving. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)

    return () => window.clearInterval(id)
  }, [ms])

  return now
}

/** "in 12 min" within a day, else "30 Sep, 09:00". */
function momentLabel(iso: string | null | undefined, now: number): string {
  if (!iso) {
    return ''
  }

  const at = new Date(iso).getTime()

  return Math.abs(at - now) < DAY ? relativeTime(at, now) : fmtDayTime.format(at)
}

export function ReminderPanel() {
  const reminders = useStore($plannerReminders)
  const { t } = useI18n()
  const c = t.dashboard.reminders
  const now = useNow(30_000)
  const upcoming = useMemo(() => reminders.filter(r => r.status !== 'fired'), [reminders])
  const fired = useMemo(() => reminders.filter(r => r.status === 'fired'), [reminders])

  return (
    <section aria-label={c.title} className="scout-panel scout-rise" style={{ '--rise-index': 2 } as React.CSSProperties}>
      <PanelHeader count={upcoming.length} icon={<Bell className="size-4" />} title={c.title} />
      <ReminderComposer />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {reminders.length === 0 ? (
          <EmptyState body={c.empty} title={c.emptyTitle} />
        ) : (
          <>
            {upcoming.length > 0 && (
              <ul className="flex flex-col gap-0.5">
                {upcoming.map(reminder => (
                  <ReminderRow key={reminder.id} now={now} reminder={reminder} />
                ))}
              </ul>
            )}
            {fired.length > 0 && (
              <div className={cn(upcoming.length > 0 && 'mt-3 border-t border-(--ui-stroke-tertiary) pt-2')}>
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[0.75rem] font-semibold text-(--ui-text-tertiary)">{c.fired}</span>
                  <Button onClick={() => void clearFiredReminders()} size="xs" variant="ghost">
                    {c.clearFired}
                  </Button>
                </div>
                <ul className="flex flex-col gap-0.5">
                  {fired.map(reminder => (
                    <ReminderRow key={reminder.id} now={now} reminder={reminder} />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

type WhenChoice = ReminderPreset | 'custom'

function ReminderComposer() {
  const { t } = useI18n()
  const c = t.dashboard.reminders
  const [text, setText] = useState('')
  const [when, setWhen] = useState<WhenChoice>('in1h')
  const [custom, setCustom] = useState(() => toLocalDateTimeValue(nextWholeHour(new Date())))
  const [repeat, setRepeat] = useState<ReminderRepeat>('never')
  const [busy, setBusy] = useState(false)

  // Repeating "in 15 min" has no clock time to repeat at, so the relative
  // presets pin the choice to Once.
  const repeatLocked = when !== 'custom' && isRelativePreset(when)

  const schedule = (): string | null => {
    if (when !== 'custom') {
      return presetSchedule(when, repeatLocked ? 'never' : repeat, new Date())
    }

    const at = parseLocalDateTime(custom)

    return at ? scheduleFor(at, repeat) : null
  }

  const submit = async () => {
    const body = text.trim()
    const at = schedule()

    if (!body || !at || busy) {
      return
    }

    setBusy(true)

    if (await addReminder(body, at)) {
      setText('')
      setRepeat('never')
    }

    setBusy(false)
  }

  return (
    <div className="mx-3 mb-2 rounded-2xl bg-(--ui-bg-quaternary) p-2 transition-shadow duration-200 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--dt-midground)_16%,transparent)]">
      <div className="flex items-center gap-1.5 pl-1">
        <Bell className="size-4 shrink-0 text-(--ui-text-tertiary)" />
        <input
          aria-label={c.textPlaceholder}
          className="min-w-0 flex-1 bg-transparent py-1 text-[0.875rem] text-foreground outline-none placeholder:text-(--ui-text-tertiary)"
          onChange={event => setText(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && void submit()}
          placeholder={c.textPlaceholder}
          value={text}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {REMINDER_PRESETS.map(preset => (
          <WhenPill active={when === preset} key={preset} label={c.presets[preset]} onClick={() => setWhen(preset)} />
        ))}
        <label
          className={cn(
            'relative inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[0.75rem] font-medium transition-colors duration-150',
            when === 'custom'
              ? 'bg-(--dt-midground) text-(--dt-midground-foreground)'
              : 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary) hover:text-foreground'
          )}
        >
          <Clock className="size-3.5" />
          {when === 'custom' ? fmtDayTime.format(parseLocalDateTime(custom) ?? new Date()) : c.custom}
          <input
            aria-label={c.custom}
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={event => {
              setCustom(event.target.value)
              setWhen('custom')
            }}
            onClick={() => setWhen('custom')}
            type="datetime-local"
            value={custom}
          />
        </label>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[0.75rem] text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) disabled:opacity-40"
            disabled={repeatLocked}
          >
            <Codicon name="sync" />
            {c.repeatOptions[repeatLocked ? 'never' : repeat]}
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup onValueChange={next => setRepeat(next as ReminderRepeat)} value={repeat}>
              {REMINDER_REPEATS.map(option => (
                <DropdownMenuRadioItem key={option} value={option}>
                  {c.repeatOptions[option]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button disabled={!text.trim() || busy} onClick={() => void submit()} size="xs">
          {c.add}
        </Button>
      </div>
    </div>
  )
}

function WhenPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={cn(
        'h-7 rounded-full px-2.5 text-[0.75rem] font-medium transition-colors duration-150',
        active
          ? 'bg-(--dt-midground) text-(--dt-midground-foreground)'
          : 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary) hover:text-foreground'
      )}
      data-slot="button"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  )
}

function ReminderRow({ now, reminder }: { now: number; reminder: PlannerReminder }) {
  const { t } = useI18n()
  const c = t.dashboard.reminders
  const fired = reminder.status === 'fired'
  const soon = !fired && reminder.next_at ? new Date(reminder.next_at).getTime() - now < 15 * 60_000 : false

  return (
    <li
      className={cn(
        'scout-row-enter group/reminder flex items-start gap-3 rounded-xl px-2 py-2 transition-colors duration-150 hover:bg-(--chrome-action-hover)',
        fired && 'opacity-70'
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full',
          fired
            ? 'bg-(--ui-bg-quaternary) text-(--ui-text-tertiary)'
            : 'bg-[color-mix(in_srgb,var(--dt-midground)_14%,transparent)] text-(--dt-midground)',
          soon && 'animate-pulse'
        )}
      >
        <Bell className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('m-0 text-[0.875rem] leading-snug', fired ? 'text-(--ui-text-secondary)' : 'text-foreground')}>
          {reminder.text}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-(--ui-text-tertiary)">
          <span className={cn('tabular-nums', soon && 'font-medium text-(--dt-midground)')}>
            {fired ? c.firedAt(momentLabel(reminder.last_fired_at, now)) : momentLabel(reminder.next_at, now)}
          </span>
          {reminder.recurring && (
            <span className="inline-flex items-center gap-1 rounded-full bg-(--ui-bg-quaternary) px-1.5 py-px">
              <Codicon name="sync" />
              {reminder.when}
            </span>
          )}
          {reminder.created_by === 'agent' && (
            <span className="inline-flex items-center gap-1">
              <ScoutOrb className="scout-orb--mini" />
              {c.byScout}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/reminder:opacity-100">
        {fired && (
          <Button onClick={() => void updateReminder(reminder.id, { when: 'in 10m' })} size="xs" variant="ghost">
            {c.snooze}
          </Button>
        )}
        <Button aria-label={c.delete} onClick={() => void deleteReminder(reminder.id)} size="icon-xs" variant="ghost">
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  )
}
