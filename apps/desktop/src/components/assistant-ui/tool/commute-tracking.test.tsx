import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CommuteTrackingCard, commuteTrackingSummary } from './commute-tracking'

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
    expect(
      commuteTrackingSummary('start_commute_eta_sync', {
        success: false,
        status: 'error',
        tracking_summary: 'not active'
      })
    ).toBeNull()
    expect(commuteTrackingSummary('other_tool', { tracking_summary: 'not a commute result' })).toBeNull()
  })

  it('lets the user dismiss the card', () => {
    const onDismiss = vi.fn()

    render(<CommuteTrackingCard dismissLabel="Dismiss" onDismiss={onDismiss} summary="Tracking active" />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
