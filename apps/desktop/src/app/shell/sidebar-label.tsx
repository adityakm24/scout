import type * as React from 'react'

import { cn } from '@/lib/utils'

interface SidebarPanelLabelProps extends React.ComponentProps<'span'> {
  meta?: React.ReactNode
}

/** Sidebar section heading — sentence case, quiet, in the manner of macOS source lists. */
export function SidebarPanelLabel({ children, className, meta, ...props }: SidebarPanelLabelProps) {
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1.5 pl-2 text-[0.75rem] font-semibold tracking-[-0.005em] text-(--ui-text-tertiary)',
        className
      )}
      {...props}
    >
      <span className="min-w-0 truncate leading-none">{children}</span>
      {meta && <span className="shrink-0 text-[0.6875rem] font-medium text-(--ui-text-quaternary)">{meta}</span>}
    </span>
  )
}
