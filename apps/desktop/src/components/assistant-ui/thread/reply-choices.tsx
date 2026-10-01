import { useAuiState } from '@assistant-ui/react'
import { type FC, type FormEvent, type KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useComposerScope } from '@/app/chat/composer/scope'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { parseReplyChoices } from '@/lib/reply-choices'
import { cn } from '@/lib/utils'
import { requestComposerSend } from '@/store/composer-send'

// One string so the selector stays a primitive: stable across the token stream.
const SEP = '\u0000'

const letter = (index: number) => String.fromCharCode(65 + index)

const ROW =
  'group/row flex w-full items-center gap-3 border-b border-(--ui-stroke-quaternary) px-3.5 py-2.5 text-left text-[length:var(--conversation-text-font-size)] leading-snug outline-none transition-colors duration-150 last:border-b-0'

const BADGE = 'grid size-6 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold'

/**
 * Quick replies for the options a finished reply offered: one tap answers, the last row takes an
 * answer in the user's own words. The card stands in for the reply's own list (hidden while it
 * shows) and the reply's question sits right above it, so the card needs no heading of its own.
 * Only on the conversation's last message, so answering retires it; every answer goes through the
 * composer exactly like a typed message. While it has focus, a letter answers and Esc dismisses.
 */
export const ReplyChoices: FC = () => {
  const { t } = useI18n()
  const copy = t.replyChoices
  const scope = useComposerScope()
  const rootRef = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<null | string>(null)
  const [draft, setDraft] = useState('')
  const [dismissed, setDismissed] = useState(false)

  // '' while streaming or once a newer message exists, so this leaf doesn't re-render per delta.
  const snapshot = useAuiState(s => {
    const messages = s.thread.messages
    const last = messages.at(-1)?.id === s.message.id
    const settled = s.message.status?.type !== 'running' && !s.thread.isRunning

    if (!last || !settled) {
      return ''
    }

    const textOf = (content: readonly { text?: string; type: string }[]) =>
      content.map(part => (part.type === 'text' ? (part.text ?? '') : '')).join('\n')

    const userMessage = messages.findLast(message => message.role === 'user')

    return `${userMessage ? textOf(userMessage.content) : ''}${SEP}${textOf(s.message.content)}`
  })

  const choices = useMemo(() => {
    if (!snapshot) {
      return null
    }

    const [userMessage, reply] = snapshot.split(SEP)

    return parseReplyChoices(reply ?? '', { userMessage })
  }, [snapshot])

  const showing = Boolean(choices) && !dismissed

  // The card replaces the reply's own list while it shows; dismissing (or answering) restores it.
  useLayoutEffect(() => {
    const content = rootRef.current?.closest('[data-slot="aui_assistant-message-content"]')
    const lists = content?.querySelectorAll<HTMLElement>('.aui-md ol, .aui-md ul')
    const source = lists?.[lists.length - 1]

    if (!showing || !source) {
      return
    }

    source.hidden = true

    return () => {
      source.hidden = false
    }
  }, [showing])

  if (!choices || !showing) {
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setDismissed(true)

      return
    }

    const index = event.key.length === 1 ? event.key.toUpperCase().charCodeAt(0) - 65 : -1

    if (!(event.target instanceof HTMLInputElement) && index >= 0 && index < choices.length) {
      event.preventDefault()
      send(choices[index])
    }
  }

  const onSubmitOther = (event: FormEvent) => {
    event.preventDefault()
    send(draft)
  }

  return (
    <div
      aria-label={copy.label}
      className="scout-pop-in mt-3 max-w-xl overflow-hidden rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated) shadow-[0_0.75rem_2rem_-1.5rem_rgb(0_0_0/0.5)]"
      data-slot="reply-choices"
      onKeyDown={onKeyDown}
      ref={rootRef}
      role="group"
    >
      {choices.map((choice, index) => {
        const chosen = picked === choice

        return (
          <button
            aria-keyshortcuts={letter(index)}
            className={cn(
              ROW,
              chosen
                ? 'bg-[color-mix(in_srgb,var(--theme-primary)_12%,transparent)] text-foreground'
                : 'text-foreground hover:bg-[color-mix(in_srgb,var(--theme-primary)_8%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--theme-primary)_8%,transparent)] disabled:opacity-45'
            )}
            disabled={picked !== null}
            key={`${index}:${choice}`}
            onClick={() => send(choice)}
            type="button"
          >
            <span
              className={cn(
                BADGE,
                chosen
                  ? 'bg-(--dt-primary-solid) text-(--dt-primary-solid-foreground)'
                  : 'bg-[color-mix(in_srgb,var(--theme-primary)_14%,transparent)] text-(--theme-primary)'
              )}
            >
              {chosen ? <Codicon name="check" size="0.75rem" /> : letter(index)}
            </span>
            <span className="min-w-0 flex-1">{choice}</span>
            <Codicon
              className="shrink-0 -translate-x-1 text-(--theme-primary) opacity-0 transition-[opacity,translate] duration-200 group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus-visible/row:translate-x-0 group-focus-visible/row:opacity-100"
              name="arrow-right"
              size="0.875rem"
            />
          </button>
        )
      })}

      <form className={cn(ROW, 'py-1.5 focus-within:bg-(--chrome-action-hover)')} onSubmit={onSubmitOther}>
        <span className={cn(BADGE, 'border border-dashed border-(--ui-stroke-tertiary) text-(--ui-text-tertiary)')}>
          <Codicon name="edit" size="0.7rem" />
        </span>
        <input
          aria-label={copy.other}
          className="min-w-0 flex-1 bg-transparent py-1 text-foreground outline-none placeholder:text-(--ui-text-tertiary)"
          disabled={picked !== null}
          onChange={event => setDraft(event.target.value)}
          placeholder={copy.other}
          value={draft}
        />
        <button
          aria-label={copy.send}
          className="grid size-7 shrink-0 place-items-center rounded-full bg-(--dt-primary-solid) text-(--dt-primary-solid-foreground) transition-[opacity,scale] duration-200 disabled:scale-90 disabled:opacity-0"
          disabled={!draft.trim() || picked !== null}
          type="submit"
        >
          <Codicon name="arrow-up" size="0.8rem" />
        </button>
      </form>
    </div>
  )
}
