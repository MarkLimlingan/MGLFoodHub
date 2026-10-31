import { ArrowRight } from 'lucide-react'
import type { OrderEditChange, OrderEditRow, PaymentMethod } from '@/lib/types'
import { PAYMENT_METHOD_LABEL } from '@/lib/orderStatus'
import { formatDate, formatDateTime, formatPhone, peso, slotLabel } from '@/lib/utils'
import { Panel } from './ui'

const FIELD_LABEL: Record<string, string> = {
  customer_name: 'Customer name',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  barangay: 'Barangay',
  city: 'City',
  landmark: 'Landmark',
  delivery_date: 'Delivery date',
  delivery_slot: 'Time slot',
  payment_method: 'Payment method',
  subtotal: 'Food subtotal',
  delivery_fee: 'Delivery fee',
  total: 'Total',
}

function formatValue(field: string, v: string | null): string {
  if (v === null || v === '') return 'none'
  switch (field) {
    case 'phone':
      return formatPhone(v)
    case 'delivery_date':
      return formatDate(v)
    case 'delivery_slot':
      return slotLabel(v)
    case 'payment_method':
      return PAYMENT_METHOD_LABEL[v as PaymentMethod] ?? v
    case 'subtotal':
    case 'delivery_fee':
    case 'total':
      return peso(v)
    default:
      return v
  }
}

/** "Delivery date", "Fri, Nov 6, 2026", "Sat, Nov 7, 2026" (items: "Item added" / "Item removed" / "Item changed"). */
export function describeChange(c: OrderEditChange): { label: string; from: string | null; to: string | null } {
  if (c.field === 'item') {
    if (c.from === null) return { label: 'Item added', from: null, to: c.to }
    if (c.to === null) return { label: 'Item removed', from: c.from, to: null }
    return { label: 'Item changed', from: c.from, to: c.to }
  }
  return { label: FIELD_LABEL[c.field] ?? c.field.replace(/_/g, ' '), from: formatValue(c.field, c.from), to: formatValue(c.field, c.to) }
}

export function ChangeLine({ change }: { change: OrderEditChange }) {
  const d = describeChange(change)
  return (
    <li className="min-w-0 text-sm">
      <span className="font-semibold">{d.label}: </span>
      {d.from !== null && <span className={d.to !== null ? 'break-words text-navy/55 line-through decoration-navy/30' : 'break-words'}>{d.from}</span>}
      {d.from !== null && d.to !== null && <ArrowRight className="mx-1 inline size-3.5 align-[-2px] text-navy/45" aria-label="changed to" />}
      {d.to !== null && <span className="break-words">{d.to}</span>}
    </li>
  )
}

/** Admin only. Never shown on the customer tracking page. */
export function EditHistoryPanel({ edits }: { edits: OrderEditRow[] }) {
  if (edits.length === 0) return null
  return (
    <Panel title="Edit history">
      <p className="-mt-2 mb-3 text-xs text-navy/55">Changes made with Edit Order. Never shown to the customer.</p>
      <ul className="space-y-3">
        {edits.map((e) => (
          <li key={e.id} className="rounded-xl bg-cream px-3 py-2.5">
            <p className="text-xs text-navy/55">
              {formatDateTime(e.created_at)} · {e.edited_by_email ?? 'admin'}
            </p>
            <ul className="mt-1.5 space-y-1">
              {e.changes.map((c, i) => (
                <ChangeLine key={i} change={c} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
