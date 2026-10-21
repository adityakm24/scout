import { describe, expect, it, vi } from 'vitest'

import { installPhoneScrollKeyboardDismiss, suppressPhoneContextMenu } from '@/platform/phone'

import { listTime, previewLine } from './phone-shell'

describe('phone chats list', () => {
  it('dates a row like Messages: the time today, then yesterday, a weekday, a date', () => {
    const now = new Date(2026, 9, 4, 15, 0)
    const at = (days: number, hour: number) => new Date(2026, 9, 4 - days, hour).getTime() / 1000

    expect(listTime(at(0, 9), now)).toMatch(/9:00/)
    expect(listTime(at(1, 23), now)).toMatch(/^Yesterday$/i)
    expect(listTime(at(3, 9), now)).toBe(new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(2026, 9, 1)))
    expect(listTime(at(30, 9), now)).not.toMatch(/day$/)
  })

  it('shows the first message under the title only when the title is not just that message', () => {
    const ask = 'okay what did DBS say in the last email?'

    expect(previewLine({ preview: ask, title: 'okay what did DBS say in the last email? #4' })).toBe('')
    expect(previewLine({ preview: ask, title: 'okay what did DBS say…' })).toBe('')
    expect(previewLine({ preview: 'can you see my saved address', title: 'Check saved addresses' })).toBe(
      'can you see my saved address'
    )
  })
})

describe('phone context menu and scroll-to-dismiss keyboard', () => {
  it('stops contextmenu propagation inside editable fields so ZoneMenu never opens, while keeping native Copy/Paste', () => {
    const zone = document.createElement('div')
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    zone.appendChild(editor)
    document.body.appendChild(zone)

    const zoneListener = vi.fn()
    zone.addEventListener('contextmenu', zoneListener)
    window.addEventListener('contextmenu', suppressPhoneContextMenu, true)

    try {
      const editableEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      editor.dispatchEvent(editableEvent)
      expect(editableEvent.defaultPrevented).toBe(false)
      expect(zoneListener).not.toHaveBeenCalled()

      const surfaceEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      zone.dispatchEvent(surfaceEvent)
      expect(surfaceEvent.defaultPrevented).toBe(true)
      expect(zoneListener).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('contextmenu', suppressPhoneContextMenu, true)
      zone.remove()
    }
  })

  it('blurs the focused composer when the user drags vertically on the thread, but not inside the composer dock', () => {
    const thread = document.createElement('div')
    const dock = document.createElement('div')
    dock.setAttribute('data-slot', 'composer-dock')
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.tabIndex = 0
    dock.appendChild(editor)
    document.body.append(thread, dock)

    const cleanup = installPhoneScrollKeyboardDismiss(window)

    try {
      editor.focus()
      expect(document.activeElement).toBe(editor)

      // Touching inside the composer dock keeps focus.
      const dockStart = new Event('touchstart', { bubbles: true })
      Object.defineProperty(dockStart, 'touches', { value: [{ clientX: 100, clientY: 500 }] })
      editor.dispatchEvent(dockStart)

      const dockMove = new Event('touchmove', { bubbles: true })
      Object.defineProperty(dockMove, 'touches', { value: [{ clientX: 100, clientY: 450 }] })
      editor.dispatchEvent(dockMove)
      expect(document.activeElement).toBe(editor)

      // Dragging vertically on the thread blurs the composer to close the keyboard.
      const threadStart = new Event('touchstart', { bubbles: true })
      Object.defineProperty(threadStart, 'touches', { value: [{ clientX: 100, clientY: 300 }] })
      thread.dispatchEvent(threadStart)

      const threadMove = new Event('touchmove', { bubbles: true })
      Object.defineProperty(threadMove, 'touches', { value: [{ clientX: 102, clientY: 330 }] })
      thread.dispatchEvent(threadMove)
      expect(document.activeElement).not.toBe(editor)
    } finally {
      cleanup()
      thread.remove()
      dock.remove()
    }
  })
})
