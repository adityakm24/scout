import type * as React from 'react'

import { cn } from '@/lib/utils'
import { agentDisplayName, type AgentIdentity } from '@/store/agent-identity'

interface AgentAvatarProps extends React.ComponentProps<'span'> {
  identity: Pick<AgentIdentity, 'avatar' | 'name'>
}

/** The agent's photo, or its initial on the accent when it has none. Size comes from `className`. */
export function AgentAvatar({ className, identity, ...props }: AgentAvatarProps) {
  const name = agentDisplayName(identity)

  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 select-none place-items-center overflow-hidden rounded-full font-semibold text-white',
        // A photo is the avatar itself: a gradient behind it shows through transparent margins
        // as a lopsided ring.
        !identity.avatar &&
          'bg-[linear-gradient(145deg,color-mix(in_srgb,var(--theme-primary)_70%,white),var(--theme-primary))] shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]',
        className
      )}
      data-slot="agent-avatar"
      {...props}
    >
      {identity.avatar ? (
        <img alt="" className="size-full object-cover" draggable={false} src={identity.avatar} />
      ) : (
        <span className="text-[0.45em] leading-none">{name.charAt(0).toUpperCase()}</span>
      )}
    </span>
  )
}
