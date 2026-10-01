import { useAuiState } from '@assistant-ui/react'
import { type FC, useMemo, useState } from 'react'

import { requestComposerFocus } from '@/app/chat/composer/focus'
import { useComposerScope } from '@/app/chat/composer/scope'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { parseReplyChoices } from '@/lib/reply-choices'
import { cn } from '@/lib/utils'
import { requestComposerSend } from '@/store/composer-send'

/** The options a finished reply asked the user to pick from, as buttons, plus a way to answer
 *  in their own words. Only on the conversation's last message, so answering retires them. */
export const ReplyChoices: FC = () => {
  const { t } = useI18n()
  const scope = useComposerScope()
  const [picked, setPicked] = useState<null | string>(null)

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

  const send = (choice: string) => {
    triggerHaptic('submit')
    setPicked(choice)
    requestComposerSend(scope.target, choice)
  }

  return (
    <div aria-label={t.replyChoices.label} className="mt-3 flex flex-wrap gap-2" data-slot="reply-choices" role="group">
      {choices.map((choice, index) => (
        <button
          className={cn(
            'scout-stagger rounded-full border px-3.5 py-1.5 text-left text-[0.8125rem] leading-snug transition-[background-color,border-color,translate] duration-200 hover:-translate-y-px',
            picked === choice
              ? 'border-transparent bg-(--dt-primary-solid) text-(--dt-primary-solid-foreground)'
              : 'border-[color-mix(in_srgb,var(--theme-primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-primary)_8%,transparent)] text-foreground hover:bg-[color-mix(in_srgb,var(--theme-primary)_16%,transparent)]'
          )}
          disabled={picked !== null}
          key={`${index}:${choice}`}
          onClick={() => send(choice)}
          type="button"
        >
          {choice}
        </button>
      ))}
      <button
        className="scout-stagger flex items-center gap-1.5 rounded-full border border-dashed border-(--ui-stroke-tertiary) px-3.5 py-1.5 text-[0.8125rem] text-(--ui-text-secondary) transition-colors hover:border-(--ui-stroke-secondary) hover:text-foreground"
        disabled={picked !== null}
        onClick={() => requestComposerFocus(scope.target)}
        type="button"
      >
        <Codicon name="edit" size="0.75rem" />
        {t.replyChoices.other}
      </button>
    </div>
  )
}
