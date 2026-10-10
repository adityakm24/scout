import { type FC, Fragment } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { Loader2 } from '@/lib/icons'
import { formatRupees, type OrderSummary } from '@/lib/order-summary'

interface OrderApprovalProps {
  busy: boolean
  onApprove: () => void
  onCancel: () => void
  order: OrderSummary
  position: number
  submitting: null | string
  total: number
}

/** A purchase waiting on the user: the basket, what it costs and how it is paid, and one
 *  deliberate "Approve & Pay". The pay button carries no `data-approval-run`, so the global
 *  Enter shortcut that runs commands never places an order; Escape still cancels. */
export const OrderApproval: FC<OrderApprovalProps> = ({
  busy,
  onApprove,
  onCancel,
  order,
  position,
  submitting,
  total
}) => {
  const { t } = useI18n()
  const copy = t.assistant.approval.order

  return (
    <div className="flex flex-col gap-3 p-3" data-slot="order-approval">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--theme-primary)_14%,transparent)] text-(--theme-primary)">
          <Codicon name="package" size="1rem" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-(--ui-text-primary)">{copy.title(order.merchant)}</span>
          <span className="text-xs text-(--ui-text-tertiary)">{copy.subtitle}</span>
        </span>
        {total > 1 && (
          <span className="ml-auto self-start text-[0.6875rem] tabular-nums text-(--ui-text-tertiary)">
            {position} / {total}
          </span>
        )}
      </div>

      {order.items.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-slot="order-items">
          {order.items.map((item, index) => (
            <li className="flex items-baseline gap-2 text-[0.8125rem]" key={`${index}:${item.name}`}>
              <span className="w-6 shrink-0 tabular-nums text-(--ui-text-tertiary)">{item.quantity}×</span>
              <span className="min-w-0 flex-1 truncate text-(--ui-text-primary)">{item.name}</span>
              {item.price !== null && (
                <span className="tabular-nums text-(--ui-text-secondary)">
                  {formatRupees(item.price * item.quantity)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {order.previewText && (
        <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-(--ui-bg-tertiary) px-2.5 py-2 font-sans text-xs leading-relaxed text-(--ui-text-secondary)">
          {order.previewText}
        </pre>
      )}

      {!order.previewLoaded && <p className="m-0 text-xs text-(--ui-red)">{copy.basketNotLoaded}</p>}

      {order.total !== null && (
        <div className="flex flex-col gap-0.5 border-t border-(--ui-stroke-tertiary) pt-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-(--ui-text-secondary)">
              {order.totalIsEstimate ? copy.itemsTotal : copy.total}
            </span>
            <span className="text-base font-semibold tabular-nums text-(--ui-text-primary)" data-slot="order-total">
              {formatRupees(order.total)}
            </span>
          </div>
          {order.totalIsEstimate && <span className="text-[0.6875rem] text-(--ui-text-tertiary)">{copy.feesNote}</span>}
        </div>
      )}

      {order.details.length > 0 && (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {order.details.map(row => (
            <Fragment key={row.label}>
              <dt className="text-(--ui-text-tertiary)">{row.label}</dt>
              <dd className="m-0 truncate text-right text-(--ui-text-primary)">{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      <div className="flex items-center gap-2 pt-1" data-slot="tool-approval-actions">
        <Button data-approval-deny="" disabled={busy} onClick={onCancel} size="sm" variant="text">
          {submitting === 'deny' ? <Loader2 className="size-3 animate-spin" /> : copy.cancel}
        </Button>
        <Button className="ml-auto flex-1" data-slot="order-approve" disabled={busy} onClick={onApprove} size="lg">
          {submitting === 'once' ? <Loader2 className="size-4 animate-spin" /> : order.label}
        </Button>
      </div>
    </div>
  )
}
