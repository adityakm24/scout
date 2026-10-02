import { useStore } from '@nanostores/react'
import { type FormEvent, useEffect, useState } from 'react'

import { getGoogleWorkspace } from '@/api/google-workspace'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { CronJob } from '@/scout'
import {
  $heartbeat,
  addEmailCheck,
  headline,
  type HeartbeatItem,
  plain,
  refreshHeartbeat,
  setHeartbeatEnabled,
  setHeartbeatRules
} from '@/store/heartbeat'
import { notifyError } from '@/store/notifications'

// The "New email check" template runs this pre-check (cron/scripts/gmail_watch.py).
const isEmailCheck = (job: CronJob) => job.script === 'gmail_watch.py'

/** What the agent does on its own, on a schedule: checks the user asked for in chat or turned on
 *  here. Each can be switched off and on; its newest finding shows under it. */
export function HeartbeatTab() {
  const { t } = useI18n()
  const copy = t.agentPanel.heartbeat
  const { items, loaded } = useStore($heartbeat)
  const [adding, setAdding] = useState(false)
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null)

  useEffect(() => {
    void refreshHeartbeat().catch(() => undefined)
    void getGoogleWorkspace()
      .then(status => setGoogleConnected(status.signed_in))
      .catch(() => setGoogleConnected(null))
  }, [])

  const hasEmailCheck = items.some(item => isEmailCheck(item.job))

  const turnOnEmailCheck = async () => {
    setAdding(true)

    try {
      await addEmailCheck()
    } catch (error) {
      notifyError(error, copy.addFailed)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4" data-slot="agent-heartbeat">
      <p className="m-0 text-xs leading-relaxed text-(--ui-text-tertiary)">{copy.intro}</p>

      {loaded && !hasEmailCheck && (
        <div className="scout-stagger flex items-start gap-3 rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--theme-primary)_40%,transparent)] p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--theme-primary)_14%,transparent)] text-(--theme-primary)">
            <Codicon name="mail" size="1rem" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[0.8125rem] font-medium">{copy.emailCheckTitle}</span>
            <span className="text-xs text-(--ui-text-secondary)">
              {googleConnected === false ? copy.emailCheckNeedsGoogle : copy.emailCheckDescription}
            </span>
          </div>
          <Button
            disabled={adding || googleConnected === false}
            loading={adding}
            onClick={() => void turnOnEmailCheck()}
            size="xs"
          >
            {copy.turnOn}
          </Button>
        </div>
      )}

      {items.map(item => (
        <HeartbeatRow item={item} key={item.job.id} />
      ))}

      {loaded && items.length === 0 && <p className="m-0 text-xs text-(--ui-text-tertiary)">{copy.empty}</p>}
    </div>
  )
}

function HeartbeatRow({ item }: { item: HeartbeatItem }) {
  const { t } = useI18n()
  const copy = t.agentPanel.heartbeat
  const { job, latest } = item
  const failed = Boolean(job.last_error) && job.enabled
  const [expanded, setExpanded] = useState(false)

  const toggle = (next: boolean) =>
    void setHeartbeatEnabled(job.id, next).catch(error => notifyError(error, copy.toggleFailed))

  return (
    <div
      className={cn(
        'scout-stagger flex flex-col gap-2 rounded-2xl border border-(--ui-stroke-quaternary) bg-(--ui-bg-elevated) p-3 transition-opacity duration-200',
        !job.enabled && 'opacity-60'
      )}
      data-slot="heartbeat-row"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--ui-bg-tertiary) text-(--theme-primary)">
          <Codicon name={isEmailCheck(job) ? 'mail' : 'pulse'} size="1rem" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.8125rem] font-medium">{job.name || copy.untitled}</span>
          <span className="truncate text-xs text-(--ui-text-tertiary)">
            {job.schedule_display || job.schedule?.display || ''}
          </span>
        </span>
        <Switch
          aria-label={
            job.enabled ? copy.turnOffNamed(job.name || copy.untitled) : copy.turnOnNamed(job.name || copy.untitled)
          }
          checked={job.enabled}
          onCheckedChange={toggle}
        />
      </div>

      {failed ? (
        <p className="m-0 line-clamp-2 text-xs text-(--ui-red)">{job.last_error}</p>
      ) : latest.text ? (
        <button
          aria-expanded={expanded}
          className="flex flex-col gap-1 rounded-xl bg-(--ui-bg-tertiary) px-2.5 py-2 text-left transition-colors duration-200 hover:bg-(--chrome-action-hover)"
          onClick={() => setExpanded(open => !open)}
          type="button"
        >
          <span className={cn('text-xs leading-relaxed text-(--ui-text-secondary)', !expanded && 'line-clamp-2')}>
            {headline(latest.text)}
          </span>
          {expanded && (
            <span className="scout-pop-in flex flex-col gap-0.5 text-xs leading-relaxed text-(--ui-text-tertiary)">
              {latest.text
                .split('\n')
                .slice(1)
                .map(line => plain(line))
                .filter(Boolean)
                .map((line, index) => (
                  <span key={index}>{line}</span>
                ))}
            </span>
          )}
          {latest.at != null && (
            <span className="text-[0.6875rem] text-(--ui-text-quaternary)">{relativeTime(latest.at * 1000)}</span>
          )}
        </button>
      ) : (
        <p className="m-0 text-xs text-(--ui-text-tertiary)">{job.enabled ? copy.nothingYet : copy.paused}</p>
      )}

      <Rules jobId={job.id} rules={job.rules ?? []} />
    </div>
  )
}

/** The user's standing rules for one job, as removable chips plus a field to add one. */
function Rules({ jobId, rules }: { jobId: string; rules: string[] }) {
  const { t } = useI18n()
  const copy = t.agentPanel.heartbeat
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  const save = (next: string[]) =>
    void setHeartbeatRules(jobId, next).catch(error => notifyError(error, copy.rulesFailed))

  const add = (event: FormEvent) => {
    event.preventDefault()
    const rule = draft.trim()

    if (rule) {
      save([...rules, rule])
    }

    setDraft('')
    setAdding(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-slot="heartbeat-rules">
      {rules.map((rule, index) => (
        <span
          className="flex max-w-full items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--theme-primary)_12%,transparent)] py-0.5 pl-2.5 pr-1 text-[0.6875rem] text-(--ui-text-secondary)"
          key={`${index}:${rule}`}
        >
          <span className="truncate">{rule}</span>
          <button
            aria-label={copy.removeRule(rule)}
            className="grid size-4 shrink-0 place-items-center rounded-full hover:bg-(--chrome-action-hover) hover:text-foreground"
            onClick={() => save(rules.filter((_, i) => i !== index))}
            type="button"
          >
            <Codicon name="close" size="0.6rem" />
          </button>
        </span>
      ))}

      {adding ? (
        <form className="flex min-w-0 flex-1" onSubmit={add}>
          <input
            aria-label={copy.addRule}
            autoFocus
            className="min-w-0 flex-1 rounded-full bg-(--ui-bg-tertiary) px-2.5 py-1 text-[0.6875rem] outline-none ring-1 ring-(--ui-stroke-tertiary) focus:ring-(--theme-primary)"
            onBlur={add}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                setDraft('')
                setAdding(false)
              }
            }}
            placeholder={copy.rulePlaceholder}
            value={draft}
          />
        </form>
      ) : (
        <button
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground"
          onClick={() => setAdding(true)}
          type="button"
        >
          <Codicon name="add" size="0.65rem" />
          {copy.addRule}
        </button>
      )}
    </div>
  )
}
