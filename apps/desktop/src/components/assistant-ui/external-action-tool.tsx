'use client'

import { type ToolCallMessagePartProps, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { type FC, useMemo } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { ToolFallback } from '@/components/assistant-ui/tool/fallback'
import { WIDGET_SHELL_CLASS } from '@/components/chat/widget-shell'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'
import { sessionApprovalRequest } from '@/store/prompts'

import { isCurrentTurnMessage } from './tool/approval-activity'
import { parseMaybeObject } from './tool/fallback-model/format'

export interface EmailPreviewData {
  body: string
  cc?: string
  replyTo?: string
  subject?: string
  to?: string
}

interface CalendarPreviewData {
  attendees?: string
  description?: string
  end?: string
  eventId?: string
  location?: string
  start?: string
  summary?: string
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]

  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Parse an email draft / send / reply card body produced by
 * `tools/external_action_tool.py` (`To: ...\nCc: ...\nSubject: ...\n\nBody` or
 * `Reply to message ...\n\nBody`).
 */
export function parseEmailPreviewFromDescription(description: string): EmailPreviewData | null {
  const normalized = description.replace(/\r\n/g, '\n').trim()

  if (!normalized) {
    return null
  }

  const blankLineIdx = normalized.indexOf('\n\n')
  const headerBlock = blankLineIdx >= 0 ? normalized.slice(0, blankLineIdx) : normalized
  const body = blankLineIdx >= 0 ? normalized.slice(blankLineIdx + 2).trim() : ''
  const headerLines = headerBlock.split('\n').map(line => line.trim())

  let to: string | undefined
  let cc: string | undefined
  let subject: string | undefined
  let replyTo: string | undefined

  for (const line of headerLines) {
    if (line.startsWith('To:')) {
      to = line.slice(3).trim()
    } else if (line.startsWith('Cc:')) {
      cc = line.slice(3).trim()
    } else if (line.startsWith('Subject:')) {
      subject = line.slice(8).trim()
    } else if (line.startsWith('Reply to message ')) {
      replyTo = line.slice('Reply to message '.length).trim()
    } else {
      return null
    }
  }

  if (!to && !subject && !replyTo) {
    return null
  }

  return { body, cc, replyTo, subject, to }
}

export interface EmailDraftFieldsProps {
  className?: string
  email: EmailPreviewData
}

export const EmailDraftFields: FC<EmailDraftFieldsProps> = ({ className, email }) => (
  <div className={cn('flex flex-col gap-2 text-xs', className)} data-slot="email-draft-fields">
    <div className="flex flex-col gap-1 rounded-xl bg-(--ui-surface-secondary)/55 px-3 py-2">
      {email.to && (
        <div className="flex items-baseline gap-2" data-slot="email-draft-to">
          <span className="w-12 shrink-0 font-medium text-(--ui-text-tertiary)">To</span>
          <span className="min-w-0 break-all text-(--ui-text-primary)">{email.to}</span>
        </div>
      )}
      {email.cc && (
        <div className="flex items-baseline gap-2" data-slot="email-draft-cc">
          <span className="w-12 shrink-0 font-medium text-(--ui-text-tertiary)">Cc</span>
          <span className="min-w-0 break-all text-(--ui-text-secondary)">{email.cc}</span>
        </div>
      )}
      {email.replyTo && (
        <div className="flex items-baseline gap-2" data-slot="email-draft-reply-to">
          <span className="w-12 shrink-0 font-medium text-(--ui-text-tertiary)">Reply</span>
          <span className="min-w-0 break-all font-mono text-[0.7rem] text-(--ui-text-secondary)">
            {email.replyTo}
          </span>
        </div>
      )}
      {email.subject && (
        <div className="flex items-baseline gap-2" data-slot="email-draft-subject">
          <span className="w-12 shrink-0 font-medium text-(--ui-text-tertiary)">Subject</span>
          <span className="min-w-0 break-words font-medium text-(--ui-text-primary)">{email.subject}</span>
        </div>
      )}
    </div>
    {email.body && (
      <div
        className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-(--ui-surface-secondary)/35 px-3 py-2.5 text-[length:var(--conversation-font-size)] leading-relaxed text-(--ui-text-primary)"
        data-slot="email-draft-body"
      >
        {email.body}
      </div>
    )}
  </div>
)

function actionTitle(action: string): string {
  switch (action) {
    case 'draft_email':
      return 'Email draft'
    case 'send_email':
      return 'Email'
    case 'reply_email':
      return 'Email reply'
    case 'create_calendar_event':
      return 'Calendar event'
    case 'delete_calendar_event':
      return 'Delete calendar event'
    default:
      return 'External action'
  }
}

function statusMeta(
  action: string,
  hasResult: boolean,
  isError: boolean | undefined,
  result: Record<string, unknown>
): { label: string; tone: 'default' | 'error' | 'pending' | 'success' } {
  if (!hasResult) {
    return { label: 'Waiting for approval', tone: 'pending' }
  }

  if (result.error_type === 'declined') {
    return { label: 'Declined', tone: 'default' }
  }

  if (isError || result.success === false) {
    return { label: 'Not sent', tone: 'error' }
  }

  if (action === 'draft_email') {
    return { label: 'Saved to Drafts', tone: 'success' }
  }

  if (action === 'send_email' || action === 'reply_email') {
    return { label: 'Sent', tone: 'success' }
  }

  if (action === 'create_calendar_event') {
    return { label: 'Added to Calendar', tone: 'success' }
  }

  if (action === 'delete_calendar_event') {
    return { label: 'Deleted', tone: 'success' }
  }

  return { label: 'Completed', tone: 'success' }
}

const STATUS_TONE_CLASS: Record<'default' | 'error' | 'pending' | 'success', string> = {
  default: 'bg-(--ui-surface-secondary) text-(--ui-text-secondary)',
  error: 'bg-destructive/15 text-destructive',
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
}

export const ExternalActionTool: FC<ToolCallMessagePartProps> = props => {
  const sessionId = useStore(useSessionView().$runtimeId)
  const approval = useStore(useMemo(() => sessionApprovalRequest(sessionId), [sessionId]))
  const currentTurn = useAuiState(state => isCurrentTurnMessage(state.thread.messages, state.message.id))

  const args = parseMaybeObject(props.args)
  const hasResult = props.result !== undefined
  const result = hasResult ? parseMaybeObject(props.result) : {}
  const action = readString(args, 'action')

  const email: EmailPreviewData | null =
    action === 'send_email' || action === 'draft_email' || action === 'reply_email'
      ? {
          body: readString(args, 'body'),
          cc: readString(args, 'cc') || undefined,
          replyTo: readString(args, 'message_id') || undefined,
          subject: readString(args, 'subject') || undefined,
          to: readString(args, 'to') || undefined
        }
      : null

  const calendar: CalendarPreviewData | null =
    action === 'create_calendar_event' || action === 'delete_calendar_event'
      ? {
          attendees: readString(args, 'attendees') || undefined,
          description: readString(args, 'description') || undefined,
          end: readString(args, 'end') || undefined,
          eventId: readString(args, 'event_id') || undefined,
          location: readString(args, 'location') || undefined,
          start: readString(args, 'start') || undefined,
          summary: readString(args, 'summary') || undefined
        }
      : null

  if (!email && !calendar) {
    return <ToolFallback {...props} />
  }

  if (email && !email.to && !email.subject && !email.body && !email.replyTo) {
    return <ToolFallback {...props} />
  }

  // While the interactive approval card is open at the bottom of the active
  // turn, it already shows this exact draft with Approve / Reject controls.
  if (!hasResult && currentTurn && approval) {
    return null
  }

  const status = statusMeta(action, hasResult, props.isError, result)
  const errorText = typeof result.error === 'string' && result.error_type !== 'declined' ? result.error.trim() : ''

  return (
    <div
      className={cn(WIDGET_SHELL_CLASS, 'my-1 flex flex-col gap-2.5')}
      data-action={action}
      data-slot="external-action-card"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-(--ui-text-secondary)">
          <Codicon name={email ? 'mail' : 'calendar'} size="0.875rem" />
          <span className="truncate">{actionTitle(action)}</span>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium leading-tight',
            STATUS_TONE_CLASS[status.tone]
          )}
          data-slot="external-action-status"
        >
          {status.label}
        </span>
      </div>

      {email && <EmailDraftFields email={email} />}

      {calendar && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-(--ui-surface-secondary)/55 px-3 py-2 text-xs">
          {calendar.summary && <div className="font-medium text-(--ui-text-primary)">{calendar.summary}</div>}
          {(calendar.start || calendar.end) && (
            <div className="text-(--ui-text-secondary)">
              {[calendar.start, calendar.end].filter(Boolean).join(' → ')}
            </div>
          )}
          {calendar.location && <div className="text-(--ui-text-secondary)">Location: {calendar.location}</div>}
          {calendar.attendees && <div className="text-(--ui-text-secondary)">Attendees: {calendar.attendees}</div>}
          {calendar.eventId && <div className="font-mono text-[0.7rem] text-(--ui-text-secondary)">ID: {calendar.eventId}</div>}
          {calendar.description && (
            <div className="mt-1 whitespace-pre-wrap break-words text-(--ui-text-primary)">{calendar.description}</div>
          )}
        </div>
      )}

      {errorText && (
        <div className="text-xs text-destructive" data-slot="external-action-error">
          {errorText}
        </div>
      )}
    </div>
  )
}
