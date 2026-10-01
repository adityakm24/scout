import { useAuiState } from '@assistant-ui/react'
import { type FC, type FormEvent, useMemo, useState } from 'react'

import { useComposerScope } from '@/app/chat/composer/scope'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { parseReplyChoices } from '@/lib/reply-choices'
import { cn } from '@/lib/utils'
import { requestComposerSend } from '@/store/composer-send'

const CHIP =
  'scout-stagger rounded-full border px-3.5 py-1.5 text-left text-[0.8125rem] leading-snug transition-[background-color,border-color,translate] duration-200'

/** The options a finished reply offered, as buttons, plus a last one that opens a field for an
 *  answer in the user's own words. Only on the conversation's last message, so answering retires
 *  them. Every answer goes through the composer, exactly like a typed message. */
export const ReplyChoices: FC = () => {
  const { t } = useI18n()
  const copy = t.replyChoices
  const scope = useComposerScope()
  const [picked, setPicked] = useState<null | string>(null)
  const [custom, setCustom] = useState<null | string>(null)

  // '' while streaming or once a newer message exists: stable across the token stream, so this
  // leaf doesn't re-render per delta (the AssistantMessageBody perf contract).
  const text = useAuiState(s => {
    const last = s.thread.messages.at(-1)?.id === s.message.id
    const settled = s.message.status?.type !== 'running' && !s.thread.isRunning

    return last && settled ? s.message.content.map(part => (part.type === 'text' ? part.text : '')).join('\n') : ''
  })

  const choices = useMemo(() => (text ? parseReplyChoices(text) : null), [text])

  if (!choices) {
    return null
  }

  const send = (answer: string) => {
    const value = answer.trim()

    if (!value || picked !== null) {
      return
    }

    triggerHaptic('submit')
    setPicked(value)
    requestComposerSend(scope.target, value)
  }

  const submitCustom = (event: FormEvent) => {
    event.preventDefault()
    send(custom ?? '')
  }

  return (
    <div aria-label={copy.label} className="mt-3 flex flex-wrap gap-2" data-slot="reply-choices" role="group">
      {choices.map((choice, index) => (
        <button
          className={cn(
            CHIP,
            picked === choice
              ? 'border-transparent bg-(--dt-primary-solid) text-(--dt-primary-solid-foreground)'
              : 'border-[color-mix(in_srgb,var(--theme-primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-primary)_8%,transparent)] text-foreground hover:-translate-y-px hover:bg-[color-mix(in_srgb,var(--theme-primary)_16%,transparent)]'
          )}
          disabled={picked !== null}
          key={`${index}:${choice}`}
          onClick={() => send(choice)}
          type="button"
        >
          {choice}
        </button>
      ))}

      {custom === null ? (
        <button
          className={cn(
            CHIP,
            'flex items-center gap-1.5 border-dashed border-(--ui-stroke-tertiary) text-(--ui-text-secondary) hover:border-(--ui-stroke-secondary) hover:text-foreground'
          )}
          disabled={picked !== null}
          onClick={() => setCustom('')}
          type="button"
        >
          <Codicon name="edit" size="0.75rem" />
          {copy.other}
        </button>
      ) : (
        <form
          className="scout-pop-in flex min-w-60 flex-1 basis-full items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--theme-primary)_45%,transparent)] bg-(--ui-bg-elevated) py-1 pl-3.5 pr-1 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--theme-primary)_15%,transparent)]"
          data-slot="reply-choices-custom"
          onSubmit={submitCustom}
        >
          <input
            aria-label={copy.placeholder}
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-foreground outline-none placeholder:text-(--ui-text-tertiary)"
            disabled={picked !== null}
            onChange={event => setCustom(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                setCustom(null)
              }
            }}
            placeholder={copy.placeholder}
            value={custom}
          />
          <button
            aria-label={copy.send}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-(--dt-primary-solid) text-(--dt-primary-solid-foreground) transition-opacity disabled:opacity-40"
            disabled={!custom.trim() || picked !== null}
            type="submit"
          >
            <Codicon name="arrow-up" size="0.8rem" />
          </button>
        </form>
      )}
    </div>
  )
}
