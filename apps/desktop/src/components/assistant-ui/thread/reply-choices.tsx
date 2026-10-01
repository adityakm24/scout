import { useAuiState } from '@assistant-ui/react'
import { type FC, type FormEvent, type KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useComposerScope } from '@/app/chat/composer/scope'
import {
  ChoiceButton,
  CLARIFY_TEXTAREA_CLASS,
  ClarifyShell,
  KeyBadge,
  letterFor,
  OPTION_ROW_CLASS
} from '@/components/assistant-ui/clarify-tool'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { MessageQuestion } from '@/lib/icons'
import { parseReplyChoices } from '@/lib/reply-choices'
import { cn } from '@/lib/utils'
import { requestComposerSend } from '@/store/composer-send'

// One string so the selector stays a primitive: stable across the token stream.
const SEP = '\u0000'

/**
 * The options a finished reply offered, as the same card the `clarify` tool shows: lettered rows,
 * a last row to answer in your own words, Skip and Continue. The list in the reply text hides
 * while the card stands in for it. Only on the conversation's last message, so answering retires
 * it; every answer goes through the composer exactly like a typed message.
 */
export const ReplyChoices: FC = () => {
  const { t } = useI18n()
  const copy = t.assistant.clarify
  const scope = useComposerScope()
  const formRef = useRef<HTMLFormElement>(null)
  const [selected, setSelected] = useState<null | number>(null)
  const [draft, setDraft] = useState('')
  const [skipped, setSkipped] = useState(false)
  const [sent, setSent] = useState(false)

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

  const showing = Boolean(choices) && !skipped

  // The card replaces the reply's own list while it shows; Skip (or answering) brings it back.
  useLayoutEffect(() => {
    const content = formRef.current?.closest('[data-slot="aui_assistant-message-content"]')
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

  const otherIndex = choices.length
  const answer = selected === otherIndex ? draft.trim() : selected === null ? '' : choices[selected]

  const send = () => {
    if (!answer || sent) {
      return
    }

    triggerHaptic('submit')
    setSent(true)
    requestComposerSend(scope.target, answer)
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    send()
  }

  // Keys act only while the card has focus: letters pick, arrows move, Enter sends, Esc skips.
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    const typing = event.target instanceof HTMLTextAreaElement

    if (event.key === 'Escape') {
      event.preventDefault()
      setSkipped(true)
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    } else if (!typing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setSelected(current => ((current ?? -step) + step + otherIndex + 1) % (otherIndex + 1))
    } else if (!typing && /^[a-z]$/i.test(event.key)) {
      const index = event.key.toUpperCase().charCodeAt(0) - 65

      if (index >= 0 && index <= otherIndex) {
        event.preventDefault()
        setSelected(index)

        if (index === otherIndex) {
          formRef.current?.querySelector('textarea')?.focus()
        }
      }
    }
  }

  return (
    <form
      aria-label={t.replyChoices.label}
      className="scout-pop-in mt-3 grid gap-2"
      data-slot="reply-choices"
      onKeyDown={onKeyDown}
      onSubmit={onSubmit}
      ref={formRef}
    >
      <ClarifyShell className="grid gap-2">
        <div className="flex items-start gap-2">
          <span className="flex-1 font-medium leading-(--conversation-line-height)">{t.replyChoices.label}</span>
          <MessageQuestion aria-hidden className="mt-px size-4 shrink-0 text-(--ui-text-tertiary)" />
        </div>
        <div className="grid gap-px" role="group">
          {choices.map((choice, index) => (
            <ChoiceButton
              active={selected === index}
              char={letterFor(index)}
              choice={choice}
              disabled={sent}
              key={`${index}:${choice}`}
              keyShortcuts={letterFor(index)}
              onClick={() => setSelected(index)}
              selected={selected === index}
            />
          ))}
          <label
            className={cn(OPTION_ROW_CLASS, 'items-center', selected === otherIndex && 'bg-(--chrome-action-hover)')}
          >
            <KeyBadge
              char={letterFor(otherIndex)}
              disabled={sent}
              preview={selected === otherIndex}
              selected={selected === otherIndex && Boolean(draft.trim())}
            />
            <Textarea
              aria-keyshortcuts={letterFor(otherIndex)}
              className={CLARIFY_TEXTAREA_CLASS}
              disabled={sent}
              onChange={event => {
                setDraft(event.target.value)
                setSelected(otherIndex)
              }}
              onFocus={() => setSelected(otherIndex)}
              placeholder={copy.other}
              rows={1}
              size="sm"
              value={draft}
            />
          </label>
        </div>
      </ClarifyShell>
      <div className="flex items-center justify-end gap-1">
        <Button disabled={sent} onClick={() => setSkipped(true)} size="xs" type="button" variant="text">
          {copy.skip}
          <span aria-hidden className="ml-0.5 text-[0.625rem] opacity-70">
            Esc
          </span>
        </Button>
        <Button disabled={sent || !answer} size="xs" type="submit">
          {copy.continueLabel}
          <span aria-hidden className="ml-0.5 text-[0.625rem] opacity-70">
            ⏎
          </span>
        </Button>
      </div>
    </form>
  )
}
