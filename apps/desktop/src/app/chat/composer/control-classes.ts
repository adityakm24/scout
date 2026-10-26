import { cn } from '@/lib/utils'

// Shared class names for the composer's control row, in a module of their own
// so both the row (`controls.tsx`) and the menus it renders can wear them
// without importing each other in a cycle.

export const ICON_BTN = 'size-(--composer-control-size) shrink-0 rounded-md'

export const GHOST_ICON_BTN = cn(
  ICON_BTN,
  'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
)

// Send primary: solid high-contrast CTA circle; always visible and expands
// smoothly when the user starts typing.
export const PRIMARY_ICON_BTN = cn(
  'size-(--composer-control-primary-size,var(--composer-control-size)) shrink-0 rounded-full p-0',
  'bg-primary text-primary-foreground shadow-sm transition-all duration-200 ease-out hover:bg-primary/90 active:scale-95',
  'disabled:pointer-events-none disabled:bg-(--ui-bg-tertiary) disabled:text-(--ui-text-tertiary) disabled:shadow-none disabled:opacity-75 disabled:scale-90'
)

/** A toggle that is currently ON — dictation, spoken replies, the wake word. */
export const ACTIVE_ICON_BTN = 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
