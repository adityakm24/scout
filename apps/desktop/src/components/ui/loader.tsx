import { type ComponentProps, useId } from 'react'

import { cn } from '@/lib/utils'

interface LoaderProps extends Omit<ComponentProps<'div'>, 'children'> {
  label?: string
}

/** Scout's loading mark: the app's face tile, its eyes looking around and blinking while it works.
 *  Drawn in `currentColor` (the eyes are cut out), so it takes the color of the text around it. */
export function Loader({
  'aria-label': ariaLabel,
  className,
  label = 'Loading',
  role = 'status',
  ...props
}: LoaderProps) {
  // useId() can contain ':' or '«»', which a url(#…) reference does not resolve.
  const mask = `scout-loader-${useId().replace(/[^\w-]/g, '')}`

  return (
    <div {...props} aria-label={ariaLabel ?? label} className={cn('size-8', className)} role={role}>
      <svg aria-hidden="true" className="scout-loader size-full overflow-visible" fill="none" viewBox="0 0 48 48">
        <mask id={mask}>
          <rect fill="white" height="48" width="48" />
          <g className="scout-loader-eyes">
            <rect fill="black" height="11" rx="3" width="6" x="15" y="18" />
            <rect fill="black" height="11" rx="3" width="6" x="27" y="18" />
          </g>
        </mask>
        <rect
          className="scout-loader-face"
          fill="currentColor"
          height="40"
          mask={`url(#${mask})`}
          rx="12"
          width="40"
          x="4"
          y="4"
        />
      </svg>
    </div>
  )
}
