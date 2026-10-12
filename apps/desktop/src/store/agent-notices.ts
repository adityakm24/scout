import { dismissNotification, type NotificationInput, type NotificationKind, notify } from '@/store/notifications'

/**
 * Wire shape of a `notification.show` payload — the driver-agnostic
 * `AgentNotice` spine (`agent/notices.py`) as forwarded by
 * `tui_gateway/server.py`. Snake_case to match the wire.
 *
 * The `text` carries its own leading severity glyph (• ⚠ ✕ ✓) from the Python
 * policy — that's how the CLI/TUI render it (glyph in a status line, no separate
 * icon). The desktop toast is different: every toast renders a kind icon, so we
 * strip the leading glyph and let that icon carry severity (see `stripGlyph`),
 * otherwise the toast shows two markers.
 *
 * - `level` is severity: info | warn | error | success.
 * - `kind` is lifetime: `sticky` (stays until an explicit clear) or `ttl`
 *   (self-expires after `ttl_ms`).
 */
export interface AgentNoticePayload {
  text?: string
  level?: string
  kind?: string
  ttl_ms?: null | number
  key?: string
  id?: string
}

const LEVEL_TO_TOAST_KIND: Record<string, NotificationKind> = {
  error: 'error',
  info: 'info',
  success: 'success',
  warn: 'warning'
}

// The severity glyphs the Python notice policy prefixes (`•` `⚠` `✕`/`✗` `✓`),
// optionally with a variation selector, plus trailing space. Stripped for the
// desktop toast because the toast already renders a kind icon.
const LEADING_GLYPH = /^[•⚠✕✗✓]\uFE0F?\s*/u

/** Drop a single leading severity glyph so the toast doesn't double up on it. */
export function stripGlyph(text: string): string {
  return text.replace(LEADING_GLYPH, '')
}

/**
 * Map an agent notice to a toast input, or `null` when it carries no text.
 *
 * Pure and side-effect free so it can be unit-tested directly. The mapping is
 * the whole contract:
 * - `level` → toast kind (info/warn/error/success, warn→warning).
 * - `sticky` → `durationMs: 0` (persists); `ttl` → `durationMs: ttl_ms`.
 * - the notice `key` doubles as the toast `id`, so re-emitting the same key
 *   REPLACES the prior toast instead of stacking, and a key-matched
 *   `notification.clear` can dismiss it.
 */
export function noticeToToast(payload: AgentNoticePayload | undefined): NotificationInput | null {
  const text = payload?.text?.trim()

  if (!text) {
    return null
  }

  const isTtl = payload?.kind === 'ttl'
  const ttl = typeof payload?.ttl_ms === 'number' && payload.ttl_ms > 0 ? payload.ttl_ms : undefined

  // The Python notice text packs a trailing detail after a middot
  // (`Primary status · detail`). On one CLI/TUI
  // status line that reads fine, but the toast follows the title-plus-description
  // convention (Sonner/shadcn): the primary status is the message and the detail
  // drops to a muted second line, instead of inlining a `·` separator.
  const [primary, meta] = splitMeta(stripGlyph(text))

  return {
    // sticky → 0 (never auto-dismiss); ttl with a ttl_ms → that value; a ttl
    // without a usable ttl_ms falls back to notify()'s per-kind default.
    durationMs: isTtl ? ttl : 0,
    id: payload?.key || payload?.id,
    kind: LEVEL_TO_TOAST_KIND[payload?.level ?? 'info'] ?? 'info',
    message: primary,
    meta
  }
}

/**
 * Split a notice line into its primary status and a trailing detail on the first
 * ` · ` (space-middot-space). No middot → the whole line is the primary and
 * there's no meta.
 */
export function splitMeta(text: string): [primary: string, meta: string | undefined] {
  const at = text.indexOf(' · ')

  if (at === -1) {
    return [text, undefined]
  }

  return [text.slice(0, at), text.slice(at + 3) || undefined]
}

/** Render a `notification.show` notice as a toast (no-op when it has no text). */
export function showAgentNotice(payload: AgentNoticePayload | undefined): void {
  const toast = noticeToToast(payload)

  if (toast) {
    notify(toast)
  }
}

/**
 * Dismiss the toast a `notification.clear` targets. The clear only ever names a
 * `key`, which we used as the toast id, so this is a key-matched dismissal.
 */
export function clearAgentNotice(key: string | undefined): void {
  if (key) {
    dismissNotification(key)
  }
}
