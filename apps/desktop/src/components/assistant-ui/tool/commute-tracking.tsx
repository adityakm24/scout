import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { toolResultRecord } from '@/lib/tool-result-metadata'

interface CommuteTrackingCardProps {
  dismissLabel: string
  onDismiss: () => void
  summary: string
}

export function commuteTrackingSummary(toolName: string, result: unknown): string | null {
  if (toolName !== 'start_commute_eta_sync' && toolName !== 'get_commute_eta_sync_status') {
    return null
  }

  const record = toolResultRecord({ result })
  const active = record.status === 'tracking' || record.active === true
  const summary = typeof record.tracking_summary === 'string' ? record.tracking_summary.trim() : ''

  return active && summary ? summary : null
}

export function CommuteTrackingCard({ dismissLabel, onDismiss, summary }: CommuteTrackingCardProps) {
  return (
    <section
      className="my-1.5 w-full max-w-xl rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-3 py-2.5 text-(--ui-text-secondary)"
      data-conversation-scaffold=""
      data-slot="commute-tracking-card"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          <CompactMarkdown className="wrap-anywhere" text={summary} />
        </div>
        <Button
          aria-label={dismissLabel}
          className="-mr-1 -mt-1 shrink-0 text-(--ui-text-tertiary)"
          onClick={onDismiss}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <Codicon name="close" size="0.75rem" />
        </Button>
      </div>
    </section>
  )
}
