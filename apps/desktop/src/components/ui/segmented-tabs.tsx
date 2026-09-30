import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export interface SegmentedTab {
  id: string
  label: ReactNode
  meta?: ReactNode
}

interface GliderBox {
  left: number
  width: number
}

/** A pill well of options with one lit pill that glides to the active option.
 *  The glider is measured from the active button, so labels of any width and
 *  late-loading counts keep it sized to its option. */
export function SegmentedTabs({
  className,
  onChange,
  tabs,
  value
}: {
  className?: string
  onChange: (id: string) => void
  tabs: SegmentedTab[]
  value: string
}) {
  const wellRef = useRef<HTMLDivElement>(null)
  const [glider, setGlider] = useState<GliderBox | null>(null)

  useLayoutEffect(() => {
    const well = wellRef.current

    if (!well) {
      return
    }

    const measure = () => {
      const active = well.querySelector<HTMLElement>('[data-active="true"]')
      const next = active ? { left: active.offsetLeft, width: active.offsetWidth } : null

      setGlider(prev => (prev && next && prev.left === next.left && prev.width === next.width ? prev : next))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(well)

    for (const child of well.children) {
      observer.observe(child)
    }

    return () => observer.disconnect()
  }, [tabs, value])

  return (
    <div
      className={cn(
        'relative inline-flex min-w-0 items-center gap-0.5 rounded-full bg-(--ui-bg-tertiary) p-1',
        className
      )}
      data-slot="segmented-tabs"
      ref={wellRef}
      role="tablist"
    >
      {glider && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-0 rounded-full bg-(--ui-chat-surface-background) shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0.25rem_0.75rem_-0.25rem_color-mix(in_srgb,var(--theme-primary)_40%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--theme-primary)_35%,transparent)]"
          data-slot="segmented-glider"
          style={{ translate: `${glider.left}px 0`, width: glider.width }}
        />
      )}
      {tabs.map(tab => {
        const active = tab.id === value

        return (
          <button
            aria-selected={active}
            className={cn(
              'relative z-10 inline-flex h-7 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors duration-200 [-webkit-app-region:no-drag] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
              active ? 'text-foreground' : 'text-(--ui-text-tertiary) hover:text-foreground'
            )}
            data-active={active}
            data-tour={`tab-${tab.id}`}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
            {tab.meta}
          </button>
        )
      })}
    </div>
  )
}
