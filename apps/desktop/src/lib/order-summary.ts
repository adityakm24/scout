// The order card's content, as the backend's order gate sends it with an approval
// (tools/mcp_tool_spending.py `order_summary`). Parsed defensively: a field that is
// missing or malformed drops out of the card instead of breaking the approval.

export interface OrderItem {
  name: string
  price: null | number
  quantity: number
}

export interface OrderDetail {
  label: string
  value: string
}

export interface OrderSummary {
  details: OrderDetail[]
  items: OrderItem[]
  /** The approve button, as the merchant's manifest names it ("Approve & Pay", "Book table"). */
  label: string
  merchant: string
  previewLoaded: boolean
  /** The merchant's own basket text, only when it could not be itemised. */
  previewText: string
  total: null | number
  totalIsEstimate: boolean
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const amount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export function parseOrderSummary(value: unknown): OrderSummary | undefined {
  const raw = record(value)
  const merchant = text(raw?.merchant)

  if (!raw || !merchant) {
    return undefined
  }

  const items = (Array.isArray(raw.items) ? raw.items : []).flatMap(entry => {
    const item = record(entry)
    const name = text(item?.name)

    return item && name
      ? [{ name, price: amount(item.price), quantity: Math.max(1, Math.round(amount(item.quantity) ?? 1)) }]
      : []
  })

  const details = (Array.isArray(raw.details) ? raw.details : []).flatMap(entry => {
    const row = record(entry)
    const label = text(row?.label)
    const value = text(row?.value)

    return label && value ? [{ label, value }] : []
  })

  return {
    details,
    items,
    label: text(raw.label) || 'Approve & Pay',
    merchant,
    previewLoaded: raw.preview_loaded !== false,
    previewText: text(raw.preview_text),
    total: amount(raw.total),
    totalIsEstimate: raw.total_is_estimate === true
  }
}

const rupees = new Intl.NumberFormat('en-IN', { currency: 'INR', maximumFractionDigits: 2, style: 'currency' })

export const formatRupees = (value: number) => rupees.format(value)
