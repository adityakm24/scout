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

const PILL =
  'flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-left text-[length:var(--conversation-text-font-size)] font-medium leading-snug outline-none transition-[background-color,color,translate,box-shadow] duration-200'

const TINT = 'bg-[color-mix(in_srgb,var(--theme-primary)_12%,transparent)] text-(--theme-primary)'

/**
 * The options a finished reply offered, as a poll (after iMessage's): the reply's question stays
 * plain text above, each option is a tinted pill with a radio on the right, and "Add your own
 * answer" opens a pill-shaped field. One tap answers. The pills stand in for the reply's own list
 * (hidden while they show). Only on the conversation's last message, so answering retires them;
 * every answer goes through the composer exactly like a typed message. While focused, a letter
 * answers and Esc dismisses.
 */
export const ReplyChoices: FC = () => {
  const { t } = useI18n()
  const copy = t.replyChoices
  const scope = useComposerScope()
  const rootRef = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<null | string>(null)
  const [draft, setDraft] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [adding, setAdding] = useState(false)

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
      className="mt-3 flex max-w-sm flex-col gap-2"
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
            aria-pressed={chosen}
            className={cn(
              PILL,
              'scout-stagger group/pill',
              chosen
                ? 'bg-(--dt-primary-solid) text-(--dt-primary-solid-foreground) shadow-[0_0.5rem_1.25rem_-0.75rem_var(--dt-primary-solid)]'
                : cn(
                    TINT,
                    'hover:-translate-y-px hover:bg-[color-mix(in_srgb,var(--theme-primary)_18%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--theme-primary)_18%,transparent)] disabled:opacity-40'
                  )
            )}
            disabled={picked !== null}
            key={`${index}:${choice}`}
            onClick={() => send(choice)}
            type="button"
          >
            <span className="min-w-0 flex-1">{choice}</span>
            <span
              aria-hidden="true"
              className={cn(
                'grid size-5.5 shrink-0 place-items-center rounded-full border-2 transition-[background-color,border-color,scale] duration-300 ease-(--ease-spring)',
                chosen
                  ? 'scale-110 border-(--dt-primary-solid-foreground) bg-(--dt-primary-solid-foreground) text-(--dt-primary-solid)'
                  : 'border-current group-hover/pill:bg-[color-mix(in_srgb,currentColor_20%,transparent)]'
              )}
            >
              {chosen && <Codicon name="check" size="0.7rem" />}
            </span>
          </button>
        )
      })}

      {adding ? (
        <form
          className={cn(
            PILL,
            TINT,
            'scout-pop-in py-1.5 pr-1.5 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--theme-primary)_20%,transparent)]'
          )}
          onSubmit={onSubmitOther}
        >
          <input
            aria-label={copy.placeholder}
            autoFocus
            className="min-w-0 flex-1 bg-transparent py-1 font-medium text-foreground outline-none placeholder:text-[color-mix(in_srgb,var(--theme-primary)_60%,transparent)]"
            disabled={picked !== null}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setAdding(false)
              }
            }}
            placeholder={copy.placeholder}
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
      ) : (
        <button
          className="scout-stagger self-end px-2 text-xs font-medium text-(--theme-primary) hover:underline disabled:opacity-40"
          disabled={picked !== null}
          onClick={() => setAdding(true)}
          type="button"
        >
          {copy.other}
        </button>
      )}
    </div>
  )
}
