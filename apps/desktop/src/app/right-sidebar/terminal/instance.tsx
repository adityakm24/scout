import '@xterm/xterm/css/xterm.css'

import { cn } from '@/lib/utils'

import { useAgentTerminal } from './use-agent-terminal'

// Absolute-stacked so inactive tabs keep layout size (a display:none host goes
// 0×0 and renders garbled on re-show); visibility toggles which one is seen.
const INSTANCE_CLASS = 'absolute inset-0 flex flex-col bg-(--ui-terminal-surface-background) px-2 pb-2 pt-0'

// xterm host. The screen/viewport overrides matter for the DOM renderer (the
// WebGL fast-path paints the canvas from ITheme.background instead) — both
// resolve to the same token, so the two renderers can't disagree.
const HOST_CLASS =
  'h-full min-h-0 overflow-hidden text-(--ui-text-secondary) [&_.xterm]:h-full [&_.xterm-screen]:bg-(--ui-terminal-surface-background)! [&_.xterm-viewport]:bg-(--ui-terminal-surface-background)!'

interface AgentTerminalInstanceProps {
  active: boolean
  id: string
  procId: string
}

/** Read-only mirror of an agent background process — a write-only xterm streamed
 *  live from the backend output (no PTY, no input). */
export function AgentTerminalInstance({ active, id, procId }: AgentTerminalInstanceProps) {
  const { hostRef } = useAgentTerminal({ active, id, procId })

  return (
    <div
      className={cn(INSTANCE_CLASS, active ? 'visible' : 'invisible pointer-events-none')}
      // Focus-scope marker so isFocusWithin('[data-terminal]')
      // routes ⌘W here and closes the focused agent tab (not a preview).
      data-terminal=""
    >
      <div className={HOST_CLASS} ref={hostRef} />
    </div>
  )
}
