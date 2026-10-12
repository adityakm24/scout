import { beforeEach, expect, test } from 'vitest'

import { type AgentNoticePayload, clearAgentNotice, noticeToToast, showAgentNotice, splitMeta } from './agent-notices'
import { $notifications, clearNotifications } from './notifications'

function notice(overrides: Partial<AgentNoticePayload> = {}): AgentNoticePayload {
  return {
    key: 'agent.status',
    kind: 'sticky',
    level: 'info',
    text: '• Indexing the workspace',
    ...overrides
  }
}

beforeEach(() => {
  clearNotifications()
})

// ── noticeToToast: the whole mapping contract ────────────────────────────────

test('drops a notice with no text', () => {
  expect(noticeToToast(undefined)).toBeNull()
  expect(noticeToToast({ text: '' })).toBeNull()
  expect(noticeToToast({ text: '   ' })).toBeNull()
})

test('level maps to toast kind (warn → warning)', () => {
  expect(noticeToToast(notice({ level: 'info' }))?.kind).toBe('info')
  expect(noticeToToast(notice({ level: 'warn' }))?.kind).toBe('warning')
  expect(noticeToToast(notice({ level: 'error' }))?.kind).toBe('error')
  expect(noticeToToast(notice({ level: 'success' }))?.kind).toBe('success')
})

test('unknown / missing level falls back to info', () => {
  expect(noticeToToast({ text: 'x', level: 'bogus' })?.kind).toBe('info')
  expect(noticeToToast({ text: 'x' })?.kind).toBe('info')
})

test('sticky notices never auto-dismiss', () => {
  expect(noticeToToast(notice({ kind: 'sticky' }))?.durationMs).toBe(0)
})

test('ttl notice carries its ttl_ms as the duration', () => {
  const toast = noticeToToast({ key: 'agent.done', kind: 'ttl', level: 'success', text: '✓ done', ttl_ms: 8000 })

  expect(toast?.durationMs).toBe(8000)
})

test('ttl notice without a usable ttl_ms defers to notify()’s default', () => {
  expect(noticeToToast({ text: 'x', kind: 'ttl' })?.durationMs).toBeUndefined()
  expect(noticeToToast({ text: 'x', kind: 'ttl', ttl_ms: 0 })?.durationMs).toBeUndefined()
})

test('the notice key is the toast id, falling back to id', () => {
  expect(noticeToToast(notice({ key: 'agent.status' }))?.id).toBe('agent.status')
  expect(noticeToToast({ text: 'x', id: 'n1', key: undefined })?.id).toBe('n1')
})

test('the leading severity glyph is stripped from the toast message', () => {
  // The toast renders a kind icon, so the message must not double up on a glyph.
  expect(noticeToToast(notice())?.message).toBe('Indexing the workspace')
  expect(noticeToToast(notice({ level: 'error', text: '✕ Index failed' }))?.message).toBe('Index failed')
  expect(noticeToToast(notice({ level: 'success', text: '✓ Index ready' }))?.message).toBe('Index ready')
})

test('the trailing "· detail" is split off as a secondary meta line, not inlined', () => {
  const failed = noticeToToast({ key: 'agent.index', level: 'error', text: '✕ Index failed · run /retry' })

  expect(failed?.message).toBe('Index failed')
  expect(failed?.meta).toBe('run /retry')

  // No middot → whole line is the message, no meta.
  const plain = noticeToToast(notice())
  expect(plain?.message).toBe('Indexing the workspace')
  expect(plain?.meta).toBeUndefined()
})

test('splitMeta splits on the first space-middot-space only', () => {
  expect(splitMeta('Index failed · run /retry')).toEqual(['Index failed', 'run /retry'])
  expect(splitMeta('Index ready')).toEqual(['Index ready', undefined])
  // Interior middots after the first split stay in the meta.
  expect(splitMeta('a · b · c')).toEqual(['a', 'b · c'])
})

// ── show / clear: rendered through the notifications store ────────────────────

test('showAgentNotice renders a toast; empty text is a no-op', () => {
  showAgentNotice(notice())
  expect($notifications.get()).toHaveLength(1)
  expect($notifications.get()[0]?.id).toBe('agent.status')

  showAgentNotice({ text: '' })
  expect($notifications.get()).toHaveLength(1)
})

test('re-emitting the same key replaces the toast instead of stacking', () => {
  showAgentNotice(notice({ level: 'info', text: '• Indexing 10%' }))
  showAgentNotice(notice({ level: 'info', text: '• Indexing 50%' }))
  showAgentNotice(notice({ level: 'warn', text: '⚠ Indexing 90%' }))

  const toasts = $notifications.get().filter(item => item.id === 'agent.status')
  expect(toasts).toHaveLength(1)
  expect(toasts[0]?.message).toBe('Indexing 90%')
  expect(toasts[0]?.kind).toBe('warning')
})

test('clearAgentNotice dismisses only the matching key', () => {
  showAgentNotice(notice())
  showAgentNotice({ key: 'agent.index', kind: 'sticky', level: 'error', text: '✕ failed' })
  expect($notifications.get()).toHaveLength(2)

  clearAgentNotice('agent.status')
  const ids = $notifications.get().map(item => item.id)
  expect(ids).toContain('agent.index')
  expect(ids).not.toContain('agent.status')

  clearAgentNotice(undefined)
  expect($notifications.get()).toHaveLength(1)
})
