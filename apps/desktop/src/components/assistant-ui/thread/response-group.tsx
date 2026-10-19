import { ThreadPrimitive, useAuiState } from '@assistant-ui/react'
import { type ComponentProps, createContext, type FC, useContext, useMemo, useState } from 'react'

import { SCAFFOLD_LABEL_CLASS, ScaffoldRow } from '@/components/chat/scaffold-row'
import { isTodoToolName } from '@/lib/todos'
import { cn } from '@/lib/utils'

import { contentHasVisibleText, messageContentText, partText, PROCESS_NOTIFICATION_RE } from './content'

interface GroupMessage {
  role: string
  content: unknown
  metadata?: { custom?: Record<string, unknown> }
}

/** Background deliveries continue the response without becoming human prompts. */
export function responseMessageRole(message: GroupMessage): string {
  const custom = message.metadata?.custom

  const background =
    message.role === 'system'
      ? Boolean(custom?.asyncResult || custom?.asyncResultKind)
      : message.role === 'user' && PROCESS_NOTIFICATION_RE.test(messageContentText(message.content))

  return background ? 'background' : message.role
}

export const ResponseMessageIds = createContext<readonly string[]>([])

export interface TurnProcessContextValue {
  /** True when the turn has a unified ChatGPT-style collapsible header for thinking & tools. */
  active: boolean
  /** True when the user has clicked to expand the thinking & tool calls drawer. */
  open: boolean
  /** ID of the message carrying the visible final answer (stays outside the collapsed drawer). */
  finalMessageId: string | null
}

const DEFAULT_TURN_PROCESS: TurnProcessContextValue = {
  active: false,
  open: false,
  finalMessageId: null
}

export const TurnProcessContext = createContext<TurnProcessContextValue>(DEFAULT_TURN_PROCESS)

export const useTurnProcess = (): TurnProcessContextValue => useContext(TurnProcessContext)

interface ResponseMessagesProps {
  components: ComponentProps<typeof ThreadPrimitive.MessageByIndex>['components']
  indices: readonly number[]
}

interface ResponseRow {
  index: number
  id: string
  role: string
  hasText: boolean
}

interface ResponseSection {
  key: string
  indices: number[]
  assistantIds: string[]
  response: boolean
}

interface TurnProcessSummary {
  hasProcess: boolean
  isRunning: boolean
  reasoningCount: number
  toolCount: number
  toolNames: string[]
  activeToolName: string | null
  finalMessageId: string | null
}

function summarizeSectionProcess(messages: readonly unknown[], indices: readonly number[]): TurnProcessSummary {
  let reasoningCount = 0
  let toolCount = 0
  let isRunning = false
  let activeToolName: string | null = null
  const toolNameSet = new Set<string>()
  let lastMessageWithPostToolText: string | null = null
  let lastMessageWithAnyText: string | null = null

  for (const idx of indices) {
    const msg = messages[idx] as
      | {
          id?: string
          role?: string
          status?: { type?: string }
          content?: readonly {
            type?: string
            text?: string
            toolName?: string
            result?: unknown
            completedAt?: number
          }[]
          metadata?: { custom?: Record<string, unknown> }
        }
      | undefined

    if (!msg || msg.role !== 'assistant') {
      continue
    }

    if (msg.status?.type === 'running') {
      isRunning = true
    }

    const parts = Array.isArray(msg.content) ? msg.content : []
    let lastToolIdx = -1

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!part) continue

      if (part.type === 'reasoning' && typeof part.text === 'string' && part.text.trim().length > 0) {
        reasoningCount += 1
      } else if (part.type === 'tool-call') {
        const name = typeof part.toolName === 'string' ? part.toolName : 'tool'
        if (!isTodoToolName(name) && name !== 'react_to_message') {
          toolCount += 1
          lastToolIdx = i
          toolNameSet.add(name)
          if (part.result === undefined && part.completedAt === undefined) {
            activeToolName = name
          }
        }
      }
    }

    const isInterim = msg.metadata?.custom?.interim === true
    let hasPostToolText = false
    let hasAnyText = false

    for (let i = 0; i < parts.length; i++) {
      if (partText(parts[i]).trim().length > 0) {
        hasAnyText = true
        if (i > lastToolIdx) {
          hasPostToolText = true
        }
      }
    }

    if (hasAnyText && msg.id) {
      lastMessageWithAnyText = msg.id
      if (hasPostToolText && !isInterim) {
        lastMessageWithPostToolText = msg.id
      }
    }
  }

  const finalMessageId = lastMessageWithPostToolText ?? (!isRunning ? lastMessageWithAnyText : null)
  const hasProcess = reasoningCount > 0 || toolCount > 0

  return {
    hasProcess,
    isRunning,
    reasoningCount,
    toolCount,
    toolNames: Array.from(toolNameSet).slice(0, 3),
    activeToolName,
    finalMessageId
  }
}

function formatTurnProcessLabel(summary: TurnProcessSummary): string {
  const { isRunning, reasoningCount, toolCount, activeToolName } = summary

  if (isRunning) {
    if (activeToolName) {
      return `Running ${activeToolName}…`
    }
    if (reasoningCount > 0 && toolCount > 0) {
      return `Thinking & used ${toolCount} tool${toolCount === 1 ? '' : 's'}…`
    }
    if (toolCount > 0) {
      return `Used ${toolCount} tool${toolCount === 1 ? '' : 's'}…`
    }
    return 'Thinking…'
  }

  if (reasoningCount > 0 && toolCount > 0) {
    return `Thought & used ${toolCount} tool${toolCount === 1 ? '' : 's'}`
  }

  if (toolCount > 0) {
    return `Used ${toolCount} tool${toolCount === 1 ? '' : 's'}`
  }

  return 'Thought'
}

const ResponseTurnSection: FC<{
  components: ComponentProps<typeof ThreadPrimitive.MessageByIndex>['components']
  section: ResponseSection
}> = ({ components, section }) => {
  const [open, setOpen] = useState(false)

  const summaryJson = useAuiState(s =>
    JSON.stringify(summarizeSectionProcess(s.thread.messages, section.indices))
  )

  const summary = useMemo(() => JSON.parse(summaryJson) as TurnProcessSummary, [summaryJson])
  const title = useMemo(() => formatTurnProcessLabel(summary), [summary])

  const contextValue = useMemo<TurnProcessContextValue>(
    () => ({
      active: summary.hasProcess,
      open,
      finalMessageId: summary.finalMessageId
    }),
    [summary.hasProcess, open, summary.finalMessageId]
  )

  return (
    <ResponseMessageIds.Provider value={section.assistantIds}>
      <TurnProcessContext.Provider value={contextValue}>
        <div className="group flex min-w-0 flex-col gap-(--scaffold-block-gap)" data-slot="aui_response-group">
          {summary.hasProcess && (
            <div
              className="mb-1 text-[length:var(--conversation-tool-font-size)] text-(--ui-text-tertiary)"
              data-conversation-scaffold=""
              data-slot="aui_turn-process-disclosure"
            >
              <ScaffoldRow
                onToggle={() => setOpen(prev => !prev)}
                open={open}
              >
                <span className={cn(SCAFFOLD_LABEL_CLASS, summary.isRunning && !open && 'shimmer')}>
                  {title}
                </span>
              </ScaffoldRow>
            </div>
          )}
          {section.indices.map(index => (
            <ThreadPrimitive.MessageByIndex components={components} index={index} key={index} />
          ))}
        </div>
      </TurnProcessContext.Provider>
    </ResponseMessageIds.Provider>
  )
}

/** Keep message runtimes intact; only their visual container and footer are shared. */
export function ResponseMessages({ components, indices }: ResponseMessagesProps) {
  const signature = useAuiState(s =>
    JSON.stringify(
      indices.flatMap(index => {
        const message = s.thread.messages[index]

        // A history replacement can notify this row before its parent updates indices.
        return message
          ? [
              {
                index,
                id: message.id,
                role: responseMessageRole(message),
                hasText: contentHasVisibleText(message.content)
              }
            ]
          : []
      })
    )
  )

  const sections = useMemo(() => {
    const rows = JSON.parse(signature) as ResponseRow[]
    const result: ResponseSection[] = []

    for (const row of rows) {
      const response = row.role === 'assistant' || row.role === 'background'
      const previous = result.at(-1)

      const section: ResponseSection =
        response && previous?.response ? previous : { key: row.id, indices: [], assistantIds: [], response }

      if (section !== previous) {
        result.push(section)
      }

      section.indices.push(row.index)

      if (row.role === 'assistant' && row.hasText) {
        section.assistantIds.push(row.id)
      }
    }

    return result
  }, [signature])

  return sections.map(section =>
    section.response ? (
      <ResponseTurnSection components={components} key={section.key} section={section} />
    ) : (
      <ThreadPrimitive.MessageByIndex components={components} index={section.indices[0]!} key={section.key} />
    )
  )
}
