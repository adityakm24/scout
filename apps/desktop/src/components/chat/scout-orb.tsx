import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Scout's presence mark on the welcome screen: a small glass sphere with a
 * slowly turning Ignition → dawn → orbit-blue core and a breathing halo.
 * Decorative only; every layer is a compositor transform (see surfaces.css).
 */
export function ScoutOrb({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span aria-hidden="true" className={cn('scout-orb', className)} {...props}>
      <span className="scout-orb__glow" />
      <span className="scout-orb__core" />
      <span className="scout-orb__glass" />
    </span>
  )
}
