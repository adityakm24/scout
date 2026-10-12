import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sessionCommands } from '../app/slash/commands/session.js'
import type { SessionUsageResponse } from '../gatewayTypes.js'
import { applyLocale, resetLocale, t } from '../i18n/runtime.js'

const usageCommand = sessionCommands.find(cmd => cmd.name === 'usage')!

const guarded =
  <T>(fn: (r: T) => void) =>
  (r: null | T) => {
    if (r) {
      fn(r)
    }
  }

/** Build a ctx whose rpc routes by method name to a supplied map of results. */
const buildCtx = (results: Record<string, unknown>) => {
  const sys = vi.fn()
  const panel = vi.fn()

  const rpc = vi.fn((method: string, _params: unknown) => Promise.resolve(results[method]))

  const ctx = {
    gateway: { rpc },
    guarded,
    guardedErr: vi.fn(),
    sid: 'sid-1',
    stale: () => false,
    transcript: { page: vi.fn(), panel, sys }
  }

  const run = async (arg: string) => {
    usageCommand.run(arg, ctx as any, 'usage')
    await rpc.mock.results[0]?.value
    await Promise.resolve()
    await Promise.resolve()
  }

  return { ctx, panel, run, sys }
}

const baseUsage = (overrides: Partial<SessionUsageResponse> = {}): SessionUsageResponse =>
  ({ calls: 0, input: 0, output: 0, total: 0, ...overrides }) as SessionUsageResponse

const printed = (sys: ReturnType<typeof vi.fn>) => sys.mock.calls.map(c => c[0]).join('\n')

const accountPanel = (panel: ReturnType<typeof vi.fn>) => {
  const sections = panel.mock.calls.find(c => c[0] === t('slashCmd.session.usage.accountTitle'))?.[1] as
    { text?: string }[] | undefined

  return (sections ?? []).map(s => s.text ?? '').join('\n')
}

describe('/usage slash command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves copy at run time, so a locale pack applied after import is observed', async () => {
    applyLocale('xx', {
      lang: 'xx',
      messages: { 'slashCmd.session.usage.noCalls': 'ZZ-NOCALLS' },
      surface: 'tui'
    })

    try {
      const { run, sys } = buildCtx({ 'session.usage': baseUsage({ calls: 0 }) })
      await run('')
      expect(printed(sys)).toContain('ZZ-NOCALLS')
    } finally {
      resetLocale()
    }
  })

  it('says "no API calls yet" only when there are no account limits to show', async () => {
    const empty = buildCtx({ 'session.usage': baseUsage({ calls: 0 }) })
    await empty.run('')
    expect(printed(empty.sys)).toContain(t('slashCmd.session.usage.noCalls'))

    const withLimits = buildCtx({ 'session.usage': baseUsage({ account_lines: ['5h window: 40% used'], calls: 0 }) })
    await withLimits.run('')
    expect(printed(withLimits.sys)).not.toContain(t('slashCmd.session.usage.noCalls'))
    expect(accountPanel(withLimits.panel)).toBe('5h window: 40% used')
  })
})
