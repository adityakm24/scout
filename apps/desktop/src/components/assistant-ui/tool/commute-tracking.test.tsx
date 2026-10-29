import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CommuteTrackingCard, commuteTrackingSummary, commuteTrackingSvg } from './commute-tracking'

describe('commute tracking card', () => {
  it('renders the active tracking summary as a visible chat card', () => {
    const summary = '🟢 **Commute Tracking Active**\n• **Destination:** Home\n• **Live Drive Time:** ~25 minutes'

    expect(
      commuteTrackingSummary('start_commute_eta_sync', {
        success: true,
        status: 'tracking',
        tracking_summary: summary
      })
    ).toBe(summary)

    const { container } = render(<CommuteTrackingCard dismissLabel="Dismiss" onDismiss={() => {}} summary={summary} />)

    expect(container.querySelector('[data-slot="commute-tracking-card"]')).not.toBeNull()
    expect(container.textContent).toContain('Commute Tracking Active')
    expect(container.textContent).toContain('Home')
    expect(container.textContent).toContain('25 minutes')
  })

  it('does not render a card for an inactive or failed tracking result', () => {
    expect(commuteTrackingSummary('get_commute_eta_sync_status', { active: false })).toBeNull()
    expect(commuteTrackingSvg('get_commute_eta_sync_status', { active: false })).toBeNull()
    expect(
      commuteTrackingSummary('start_commute_eta_sync', {
        success: false,
        status: 'error',
        tracking_summary: 'not active'
      })
    ).toBeNull()
    expect(commuteTrackingSummary('other_tool', { tracking_summary: 'not a commute result' })).toBeNull()
  })

  it('renders the active tracking SVG returned by the tool', async () => {
    const result = {
      status: 'tracking',
      tracking_summary: 'Commute tracking active',
      tracking_card_markdown:
        '```svg\n<svg xmlns="http://www.w3.org/2000/svg"><text>LIVE DRIVE</text><script>alert(1)</script></svg>\n```'
    }

    const svg = commuteTrackingSvg('start_commute_eta_sync', result)

    expect(svg).toContain('<text>LIVE DRIVE</text>')

    const { container } = render(
      <CommuteTrackingCard
        dismissLabel="Dismiss"
        onDismiss={() => {}}
        summary={result.tracking_summary}
        svg={svg}
      />
    )

    await waitFor(() => expect(container.querySelector('[data-slot="commute-tracking-card"] svg')).not.toBeNull())

    expect(container.querySelector('script')).toBeNull()
  })

  it('updates the displayed SVG when a status refresh returns new route data', async () => {
    const resultFor = (minutes: number) => ({
      active: true,
      tracking_summary: `Live drive time is about ${minutes} minutes`,
      tracking_card_markdown: `\`\`\`svg\n<svg xmlns="http://www.w3.org/2000/svg"><text>~${minutes}m</text></svg>\n\`\`\``
    })

    const initial = resultFor(38)

    const { container, rerender } = render(
      <CommuteTrackingCard
        dismissLabel="Dismiss"
        onDismiss={() => {}}
        summary={initial.tracking_summary}
        svg={commuteTrackingSvg('start_commute_eta_sync', initial)}
      />
    )

    await waitFor(() => expect(container.querySelector('svg')?.textContent).toContain('~38m'))

    const refreshed = resultFor(31)

    rerender(
      <CommuteTrackingCard
        dismissLabel="Dismiss"
        onDismiss={() => {}}
        summary={refreshed.tracking_summary}
        svg={commuteTrackingSvg('get_commute_eta_sync_status', refreshed)}
      />
    )

    await waitFor(() => expect(container.querySelector('svg')?.textContent).toContain('~31m'))
  })

  it('lets the user dismiss the card', () => {
    const onDismiss = vi.fn()

    render(<CommuteTrackingCard dismissLabel="Dismiss" onDismiss={onDismiss} summary="Tracking active" />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
