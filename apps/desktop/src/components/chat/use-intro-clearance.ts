import { type RefObject, useLayoutEffect } from 'react'

const COMPOSER_GAP_PX = 20
const HEADER_GAP_PX = 8
const MIN_SCALE = 0.6

export interface IntroFit {
  /** Pixels to move the greeting up. */
  lift: number
  /** Shrink factor about the greeting's bottom centre. */
  scale: number
}

/** Where the empty-chat greeting goes so it ends above the composer (`floor`) and starts below the
 *  agent header (`ceiling`): lifted until it clears the composer, then shrunk from its bottom edge
 *  when the column is too short to hold it. All values are viewport pixels. */
export function introFit(natural: { bottom: number; height: number }, floor: number, ceiling: number): IntroFit {
  const bottom = Math.min(natural.bottom, floor)
  const room = bottom - ceiling
  const scale = natural.height > 0 ? Math.min(1, Math.max(MIN_SCALE, room / natural.height)) : 1

  return { lift: Math.max(0, natural.bottom - bottom), scale }
}

/** Keeps the greeting clear of the centred composer at any window size. The composer is placed off
 *  the chat surface's height while the greeting sits in the scrolling thread, so CSS alone cannot
 *  relate them: a narrow column or a long greeting used to slide the text under the composer. */
export function useIntroClearsComposer(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const content = ref.current
    const surface = content?.closest<HTMLElement>('[data-chat-surface]')

    if (!content || !surface) {
      return
    }

    let frame = 0
    let applied: IntroFit = { lift: 0, scale: 1 }

    const fit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const dock = surface.querySelector<HTMLElement>('[data-slot="composer-dock"]')
        const composer = dock?.querySelector('[data-slot="composer-surface"]')
        const header = surface.querySelector('[data-slot="agent-identity-header"]')
        const surfaceBox = surface.getBoundingClientRect()

        // A popped-out composer floats elsewhere; the greeting only has to clear the surface edge.
        const floor =
          (composer && !dock?.hasAttribute('data-popped-out')
            ? composer.getBoundingClientRect().top
            : surfaceBox.bottom) - COMPOSER_GAP_PX

        const ceiling = (header ? header.getBoundingClientRect().bottom : surfaceBox.top) + HEADER_GAP_PX
        const box = content.getBoundingClientRect()
        // Undo the adjustment already applied to recover the natural box.
        const natural = { bottom: box.bottom + applied.lift, height: box.height / applied.scale }
        const next = introFit(natural, floor, ceiling)

        if (Math.abs(next.lift - applied.lift) < 0.5 && Math.abs(next.scale - applied.scale) < 0.005) {
          return
        }

        applied = next
        content.style.translate = next.lift ? `0 ${-next.lift}px` : ''
        content.style.scale = next.scale < 1 ? String(next.scale) : ''
      })
    }

    const observer = new ResizeObserver(fit)
    observer.observe(content)
    observer.observe(surface)

    const composer = surface.querySelector('[data-slot="composer-surface"]')

    if (composer) {
      observer.observe(composer)
    }

    // The composer glides to centre stage when the empty chat mounts; settle on where it lands.
    const dock = surface.querySelector('[data-slot="composer-dock"]')
    dock?.addEventListener('transitionend', fit)
    fit()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      dock?.removeEventListener('transitionend', fit)
    }
  }, [ref])
}
