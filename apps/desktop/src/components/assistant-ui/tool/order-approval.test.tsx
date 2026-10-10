import { AssistantRuntimeProvider, type ThreadMessage, useExternalStoreRuntime } from '@assistant-ui/react'
import { act, cleanup, fireEvent, render as renderUi, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { handleApprovalKey, releaseApprovalKey } from '@/lib/keybinds/approval-keys'
import { parseOrderSummary } from '@/lib/order-summary'
import type { ScoutGateway } from '@/scout'
import { $gateway } from '@/store/gateway'
import { $approvalRequest, clearAllPrompts, setApprovalRequest } from '@/store/prompts'
import { resetServerRequestsForTests } from '@/store/server-requests'
import { $activeSessionId } from '@/store/session'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { PendingApprovalStack } from './approval'

// What tools/mcp_tool_spending.py sends with a purchase approval.
const ORDER = {
  merchant: 'Zepto',
  label: 'Approve & Pay',
  items: [
    { name: 'Chips', quantity: 2, price: 21 },
    { name: 'Milk', quantity: 1, price: 30 }
  ],
  total: 72,
  total_is_estimate: true,
  details: [{ label: 'Payment', value: 'Cash on delivery' }],
  preview_text: '',
  preview_loaded: true
}

function Runtime({ children }: { children: ReactNode }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({ messages: [], isRunning: false, onNew: async () => {} })

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}

function showOrder(order: unknown) {
  $activeSessionId.set('sess-1')
  setApprovalRequest({
    choices: ['once', 'deny'],
    command: 'Zepto: Approve & Pay?',
    description: 'Zepto will place this order.',
    order: parseOrderSummary(order),
    requestId: 'order-1',
    sessionId: 'sess-1'
  })
  renderUi(
    <Runtime>
      <PendingApprovalStack />
    </Runtime>
  )
}

beforeAll(() => {
  stubMenuDomApis()
  stubResizeObserver()
})

afterEach(() => {
  cleanup()
  releaseApprovalKey()
  clearAllPrompts()
  resetServerRequestsForTests()
  $activeSessionId.set(null)
  $gateway.set(null)
})

describe('order approval card', () => {
  it('shows the basket, its total and how it is paid, and pays only on a click', async () => {
    const rpc = vi.fn().mockResolvedValue({ resolved: true })
    $gateway.set({ request: rpc } as unknown as ScoutGateway)
    showOrder(ORDER)

    expect(screen.getByText('Zepto order')).toBeTruthy()
    expect(screen.getByText('Chips')).toBeTruthy()
    expect(screen.getByText('Cash on delivery')).toBeTruthy()
    expect(document.querySelector('[data-slot="order-total"]')?.textContent).toContain('72')

    // The Enter shortcut that runs a command never places an order.
    act(() => {
      handleApprovalKey(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    })
    expect(rpc).not.toHaveBeenCalled()
    expect($approvalRequest.get()?.requestId).toBe('order-1')

    fireEvent.click(screen.getByRole('button', { name: 'Approve & Pay' }))
    await waitFor(() => expect($approvalRequest.get()).toBeNull())
    expect(rpc.mock.calls[0].slice(0, 2)).toEqual([
      'approval.respond',
      expect.objectContaining({ choice: 'once', request_id: 'order-1' })
    ])
  })

  it('falls back to the plain card when the summary is not an order', () => {
    showOrder({ items: 'nonsense' })

    expect(screen.queryByText('Approve & Pay')).toBeNull()
    expect(screen.getByRole('button', { name: /Run/ })).toBeTruthy()
  })
})
