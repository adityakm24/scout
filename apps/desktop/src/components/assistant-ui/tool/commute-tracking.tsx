import { RichCodeBlock } from '@/components/assistant-ui/embeds'
import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { toolResultRecord } from '@/lib/tool-result-metadata'

interface CommuteTrackingCardProps {
  dismissLabel: string
  onDismiss: () => void
  status?: string
  summary: string
  svg?: string | null
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

export function commuteTrackingSvg(toolName: string, result: unknown): string | null {
  if (!commuteTrackingSummary(toolName, result)) {
    return null
  }

  const record = toolResultRecord({ result })
  const markdown = typeof record.tracking_card_markdown === 'string' ? record.tracking_card_markdown : ''
  const svg = markdown.match(/```svg\s*([\s\S]*?)\s*```/i)?.[1]?.trim()

  return svg?.startsWith('<svg') && svg.endsWith('</svg>') ? svg : null
}

export function CommuteTrackingCard({
  dismissLabel,
  onDismiss,
  status,
  summary,
  svg
}: CommuteTrackingCardProps) {
  return (
    <section
      className="my-1.5 w-full max-w-xl rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-3 py-2.5 text-(--ui-text-secondary)"
      data-conversation-scaffold=""
      data-slot="commute-tracking-card"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          {svg && <RichCodeBlock code={svg} fallback={null} language="svg" />}
          <CompactMarkdown className="wrap-anywhere" text={summary} />
          {status && <p className="mt-1 text-[0.6875rem] text-(--ui-text-tertiary)">{status}</p>}
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
