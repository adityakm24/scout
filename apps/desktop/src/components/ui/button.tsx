import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import * as React from 'react'

import { Loader2 } from '@/lib/icons'
import { cn } from '@/lib/utils'

// Text+icon actions underline the label on hover, not the glyph.
const TEXT_ACTION_ICON = '[&_.codicon]:no-underline [&_svg]:no-underline'

// Buttons are curved Apple capsules (`rounded-full`) and sized by padding +
// line-height so they scale cleanly across desktop, web, and phone.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full text-xs leading-4 font-medium whitespace-nowrap shadow-none transition-all duration-150 outline-none focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-default disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        // Disabled reads as neutral, not as a faded accent (a 50% orange is muddy).
        default:
          'bg-[#007aff] text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.28),0_1px_2px_rgba(0,0,0,0.18)] hover:bg-[#006ee6] active:bg-[#0062cc] dark:bg-[#0a84ff] dark:hover:bg-[#2492ff] disabled:bg-(--ui-bg-tertiary) disabled:text-(--ui-text-tertiary) disabled:shadow-none disabled:opacity-100',
        destructive:
          'bg-[#ff3b30] text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.25)] hover:bg-[#e6352b] focus-visible:ring-destructive/20 dark:bg-[#ff453a] dark:hover:bg-[#ff584e] dark:focus-visible:ring-destructive/40',
        // Quiet action — subtle translucent fill with a crisp 1px inset border.
        outline:
          'bg-(--ui-bg-tertiary)/80 text-(--ui-text-primary) shadow-[inset_0_0.5px_0_rgba(255,255,255,0.08),inset_0_0_0_1px_var(--ui-stroke-secondary)] hover:bg-(--ui-bg-quaternary) hover:text-(--ui-text-primary)',
        // Soft-fill action (the default "non-primary button" look).
        secondary:
          'bg-(--ui-bg-quaternary) text-(--ui-text-primary) shadow-[inset_0_0.5px_0_rgba(255,255,255,0.08),inset_0_0_0_1px_var(--ui-stroke-tertiary)] hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)',
        // Clickable tag/filter chip — the soft fill plus a hairline inset ring on
        // hover (shadow, not border, so nothing reflows).
        chip: 'bg-(--ui-bg-quaternary) text-(--ui-text-primary) hover:bg-(--chrome-action-hover) hover:shadow-[inset_0_0_0_0.5px_var(--ui-stroke-secondary)]',
        ghost: 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)',
        grip: 'bg-transparent text-(--ui-text-tertiary) transition-colors hover:text-(--ui-text-secondary) focus-visible:text-(--ui-text-primary)',
        // A control floating free of any surface (fan-menu discs, detached
        // chips): the menu/popover treatment — opaque popover fill + the
        // shared `shadow-md` ring-and-drop. Hover only lifts the glyph; a fill
        // change on a lone disc reads as a toggle flipping.
        floating: 'bg-popover text-(--ui-text-secondary) shadow-md hover:text-(--ui-text-primary)',
        link: `text-primary underline-offset-4 decoration-current/20 hover:underline ${TEXT_ACTION_ICON}`,
        // Boxless inline-text action (no bg/border). Quiet by default — reads as
        // muted label text, underlines on hover (e.g. "Cancel", "Clear").
        text: `text-muted-foreground underline-offset-4 hover:text-foreground hover:underline ${TEXT_ACTION_ICON}`,
        // Emphasized inline-text action: bold + always-underlined link. Use for
        // the actionable affordance in a row ("Change", "Set", "Open logs", …).
        textStrong: `font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground ${TEXT_ACTION_ICON}`
      },
      size: {
        default: 'px-3.5 py-1.5 text-[0.8125rem] leading-4 has-[>svg]:px-3',
        xs: "gap-1 px-2.5 py-1 text-xs leading-4 has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: 'px-3 py-1.5 text-xs leading-4 has-[>svg]:px-2.5',
        lg: 'px-5 py-2.5 text-sm leading-5 has-[>svg]:px-4',
        // Flush inline text action — no box padding/height. Pair with text/link
        // variants when the button must sit inline in a heading or sentence
        // (replaces ad-hoc `h-auto px-0 py-0` overrides).
        inline: 'h-auto gap-1 p-0 has-[>svg]:px-0',
        // Status-stack headers, table footers — 12px text actions beside a label.
        micro:
          "h-auto gap-0.5 px-1 py-0 text-xs leading-4 font-normal has-[>svg]:px-0.5 [&_svg:not([class*='size-'])]:size-3",
        // Icon buttons are concentric capsules/circles matching the button scale.
        icon: 'size-9 rounded-full',
        'icon-xs': "size-6 rounded-full [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 rounded-full',
        'icon-lg': 'size-10 rounded-full',
        grip: 'h-4 w-12 rounded-full p-0',
        'icon-titlebar':
          'titlebar-icon-button h-(--titlebar-control-height) w-(--titlebar-control-size) rounded-full [&_svg:not([class*="size-"])]:size-(--titlebar-icon-size)'
      }
    },
    compoundVariants: [
      // textStrong is a boxless link — size variants still inject px-*; strip
      // inline padding so the underline sits flush with the label.
      {
        variant: 'textStrong',
        class: 'px-0 has-[>svg]:px-0'
      }
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  loading = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Working. The label stays in flow but goes invisible and a spinner
     *  sits over it, so the button keeps its exact width and height — a
     *  label swapped for a glyph reflows every sibling on the row. */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), loading && 'relative', className)}
      data-size={size}
      data-slot="button"
      data-variant={variant}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          {/* Same flex + gap as the button itself, so the ghost label measures
              exactly what the live one did. The spinner sits in a wrapper so
              it is never a direct-child svg — the size variants' `has-[>svg]`
              would otherwise switch to icon padding and shave the width. */}
          <span aria-hidden className="invisible inline-flex items-center gap-[inherit]">
            {children}
          </span>
          <span aria-hidden className="absolute inset-0 grid place-items-center">
            <Loader2 className="animate-spin" />
          </span>
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
