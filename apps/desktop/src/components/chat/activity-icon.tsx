import { Codicon } from '@/components/ui/codicon'
import { ToolIcon } from '@/components/ui/tool-icon'
import { cn } from '@/lib/utils'

/** What the agent is doing right now, as one animated glyph: a glowing bulb while it thinks,
 *  a sweeping magnifier while it searches, a blinking cursor while a command runs. */
export type ActivityKind = 'edit' | 'memory' | 'read' | 'search' | 'terminal' | 'thinking' | 'tool' | 'wait' | 'web'

// Tool icon names (TOOL_META in fallback-model) → the activity they animate as.
const KIND_BY_ICON: Record<string, ActivityKind> = {
  brain: 'memory',
  diff: 'edit',
  edit: 'edit',
  eye: 'read',
  file: 'read',
  'file-media': 'read',
  files: 'read',
  globe: 'web',
  search: 'search',
  terminal: 'terminal',
  watch: 'wait'
}

// Tools without a row icon of their own (bridge and MCP calls) still read as their verb.
const KIND_BY_TOOL: Record<string, ActivityKind> = { tool_describe: 'read', tool_search: 'search' }

/** A running tool row's activity, from the icon it already shows. */
export const activityKindForIcon = (icon?: string): ActivityKind => (icon && KIND_BY_ICON[icon]) || 'tool'

export function activityKindFor(toolName?: null | string, icon?: string): ActivityKind {
  if (icon && KIND_BY_ICON[icon]) {
    return KIND_BY_ICON[icon]
  }

  if (toolName) {
    return KIND_BY_TOOL[toolName] ?? 'tool'
  }

  return 'thinking'
}

const GLYPH: Record<ActivityKind, { codicon?: string; tool?: string }> = {
  edit: { tool: 'edit' },
  memory: { tool: 'brain' },
  read: { tool: 'file' },
  search: { tool: 'search' },
  terminal: { tool: 'terminal' },
  thinking: { codicon: 'lightbulb' },
  tool: { tool: 'tools' },
  wait: { tool: 'watch' },
  web: { tool: 'globe' }
}

interface ActivityIconProps {
  className?: string
  /** A specific tool icon to animate (a tool row's own glyph); defaults to the kind's glyph. */
  icon?: string
  kind: ActivityKind
  label?: string
  size?: string
}

export function ActivityIcon({ className, icon, kind, label, size = '0.875rem' }: ActivityIconProps) {
  const glyph = GLYPH[kind]

  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn('scout-activity relative inline-grid shrink-0 place-items-center', className)}
      data-activity={kind}
      role={label ? 'img' : undefined}
      style={{ height: size, width: size }}
    >
      <span className="scout-activity__glyph grid place-items-center">
        {icon || glyph.tool ? (
          <ToolIcon name={icon ?? glyph.tool!} size={size} />
        ) : (
          <Codicon name={glyph.codicon!} size={size} />
        )}
      </span>
      {kind === 'terminal' && <span className="scout-activity__cursor" />}
    </span>
  )
}
