import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Ban, Copy, Lock, Plus, RotateCcw, Save, Search, Trash2 } from 'lucide-react'
import { supabase, errorMessage } from '@/lib/supabase'
import { useCatalog, type Catalog } from '@/hooks/useCatalog'
import type { OptionChoice, OrderEditChange, OrderItemRow, OrderOption, OrderRow, PaymentMethod, Product } from '@/lib/types'
import { COD_MAX, COD_MAX_LABEL, ONLINE_METHODS, PAYMENT_METHOD_LABEL } from '@/lib/orderStatus'
import { computeSlots } from '@/lib/slots'
import {
  addDays, cn, copyText, formatDate, formatDateTime, formatHours, isValidEmail, manilaNow, normalizePhone, peso, randomId, slotLabel, toCents, trackingUrl,
} from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Checkbox, Chip, QuantityStepper, Skeleton } from '@/components/ui/controls'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, ErrorBanner } from '@/components/common'
import { AdminPageHeader, OrderBadges, Panel } from './ui'
import { ChangeLine } from './editHistory'
import { useAdminLive } from './AdminLayout'

/** A line in the editor. Existing lines keep their order_items id; new ones have id null. */
interface Line {
  key: string
  id: string | null
  productId: string
  variantId: string
  quantity: number
  /** New lines only (existing lines keep their saved options). */
  choiceIds: string[]
  extraToppings: boolean
}

interface Form {
  customer_name: string
  phone: string
  email: string
  address: string
  barangay: string
  city: string
  landmark: string
  delivery_date: string
  delivery_slot: string
  delivery_fee: string
  payment_method: PaymentMethod
}

type Errors = Partial<Record<keyof Form | 'items', string>>

const MIGRATION = 'supabase/migrations/20261031000100_edit_order.sql'
const SCHEDULE_OPEN = ['processing', 'confirmed', 'preparing']

const lineFromItem = (i: OrderItemRow): Line => ({
  key: i.id, id: i.id, productId: i.product_id, variantId: i.variant_id, quantity: i.quantity, choiceIds: [], extraToppings: false,
})

const formFromOrder = (o: OrderRow): Form => ({
  customer_name: o.customer_name,
  phone: o.phone,
  email: o.email,
  address: o.address,
  barangay: o.barangay,
  city: o.city,
  landmark: o.landmark ?? '',
  delivery_date: o.delivery_date,
  delivery_slot: o.delivery_slot,
  delivery_fee: String(Number(o.delivery_fee)),
  payment_method: o.payment_method,
})

/** Same text the database writes to the edit history: "2× Bangus (4 pcs) · Spicy". */
function lineText(qty: number, product: string, variant: string, options: OrderOption[]) {
  const opts = options.map((x) => (x.group === 'Extra Toppings' ? 'Extra toppings' : x.choice))
  return `${qty}× ${product}${variant !== 'Regular' ? ` (${variant})` : ''}${opts.length ? ` · ${opts.join(', ')}` : ''}`
}

interface LineView {
  productName: string
  storeId: string
  storeName: string
  variantLabel: string
  options: OrderOption[]
  unitCents: number
  error: string | null
}

/** Name, options and price of a line. Kept lines keep the price they were ordered at; changed or new lines use the menu price. */
function viewLine(l: Line, original: Map<string, OrderItemRow>, cat: Catalog, choiceById: Map<string, OptionChoice>): LineView {
  const o = l.id ? original.get(l.id) : undefined
  const product = cat.productById.get(l.productId)
  const variant = cat.variantById.get(l.variantId)
  const store = cat.storeById.get(product?.store_id ?? o?.store_id ?? '')
  const base = {
    productName: o?.product_name_snapshot ?? product?.name ?? 'Unknown product',
    storeId: product?.store_id ?? o?.store_id ?? '',
    storeName: o?.store_name_snapshot ?? store?.name ?? '',
  }
  if (o && l.variantId === o.variant_id) {
    return { ...base, variantLabel: o.variant_label_snapshot, options: o.options_snapshot, unitCents: toCents(o.unit_price_snapshot), error: null }
  }
  if (!product || !variant) return { ...base, variantLabel: '', options: [], unitCents: 0, error: 'This product is no longer on the menu.' }

  let cents = toCents(variant.price)
  let options: OrderOption[]
  let error: string | null = null
  if (o) {
    // New size of an existing item: same choices, Extra Toppings follow the new size.
    options = o.options_snapshot.map((x) => (x.group === 'Extra Toppings' ? { ...x, price_delta: variant.addon_price ?? 0 } : x))
    if (o.options_snapshot.some((x) => x.group === 'Extra Toppings') && variant.addon_price === null) {
      error = `Extra toppings are not available for ${variant.label}.`
    }
  } else {
    options = l.choiceIds.flatMap((cid) => {
      const c = choiceById.get(cid)
      const g = c && cat.groups.find((x) => x.id === c.group_id)
      return c && g ? [{ group: g.name, choice: c.label, price_delta: Number(c.price_delta) }] : []
    })
    if (l.extraToppings && variant.addon_price !== null) options.push({ group: 'Extra Toppings', choice: 'Yes', price_delta: variant.addon_price })
  }
  for (const x of options) cents += toCents(x.price_delta)
  if (product.is_sold_out || variant.is_sold_out) error = `${product.name} (${variant.label}) is sold out.`
  if (store && !store.is_accepting_orders) error = `${store.name} is not accepting orders right now.`
  return { ...base, variantLabel: variant.label, options, unitCents: cents, error }
}

export default function OrderEdit() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const cat = useCatalog()
  const { version } = useAdminLive()
  const [order, setOrder] = useState<OrderRow | null>(null)
  const [items, setItems] = useState<OrderItemRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [form, setForm] = useState<Form | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [blockedDates, setBlockedDates] = useState<string[]>([])
  const [errors, setErrors] = useState<Errors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const saved = useRef(false)

  const load = useCallback(async () => {
    const [o, it] = await Promise.all([
      supabase.from('orders').select('*').eq('id', id).maybeSingle(),
      supabase.from('order_items').select('*').eq('order_id', id).order('line_no'),
    ])
    if (o.error || it.error) return setLoadError(errorMessage(o.error ?? it.error))
    if (!o.data) return setMissing(true)
    const row = o.data as OrderRow
    const list = (it.data ?? []) as OrderItemRow[]
    setOrder(row)
    setItems(list)
    setForm(formFromOrder(row))
    setLines(list.map(lineFromItem))
    setErrors({})
    setSaveError(null)
    setStale(false)
    setLoadError(null)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void supabase
      .from('settings')
      .select('value')
      .eq('key', 'blocked_dates')
      .maybeSingle()
      .then(({ data }) => Array.isArray(data?.value) && setBlockedDates(data.value as string[]))
  }, [])

  // Someone changed the order (status, payment, another admin) while this page is open.
  const loadedAt = order?.updated_at
  useEffect(() => {
    if (!loadedAt) return
    void supabase
      .from('orders')
      .select('updated_at')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (data && data.updated_at !== loadedAt && !saved.current) setStale(true)
      })
  }, [version, id, loadedAt])

  const original = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const choiceById = useMemo(() => new Map(cat.choices.map((c) => [c.id, c])), [cat.choices])
  const views = useMemo(() => lines.map((l) => viewLine(l, original, cat, choiceById)), [lines, original, cat, choiceById])
  const subtotalCents = views.reduce((n, v, i) => n + v.unitCents * lines[i].quantity, 0)
  const feeNumber = Number(form?.delivery_fee)
  const feeValid = form !== null && form.delivery_fee.trim() !== '' && Number.isFinite(feeNumber) && feeNumber >= 0 && feeNumber <= 100000
  const feeCents = feeValid ? toCents(feeNumber) : 0
  const totalCents = subtotalCents + feeCents

  // Stores in the edited order, and the 1-hour slots they all deliver in (same rule as checkout).
  const orderStores = useMemo(() => {
    const ids = [...new Set(views.map((v) => v.storeId))]
    return ids.map((sid) => cat.storeById.get(sid)).filter((s): s is NonNullable<typeof s> => !!s)
  }, [views, cat.storeById])
  const slotInfo = useMemo(() => computeSlots(orderStores), [orderStores])

  // Every change, in the same shape as the saved edit history.
  const changes = useMemo<OrderEditChange[]>(() => {
    if (!order || !form) return []
    const out: OrderEditChange[] = []
    for (const i of items) {
      const from = lineText(i.quantity, i.product_name_snapshot, i.variant_label_snapshot, i.options_snapshot)
      const idx = lines.findIndex((l) => l.id === i.id)
      if (idx < 0) out.push({ field: 'item', from, to: null })
      else {
        const v = views[idx]
        const to = lineText(lines[idx].quantity, v.productName, v.variantLabel, v.options)
        if (to !== from) out.push({ field: 'item', from, to })
      }
    }
    lines.forEach((l, idx) => {
      if (!l.id) out.push({ field: 'item', from: null, to: lineText(l.quantity, views[idx].productName, views[idx].variantLabel, views[idx].options) })
    })
    const phone = normalizePhone(form.phone) ?? form.phone.trim()
    const fields: [string, string | null, string | null][] = [
      ['customer_name', order.customer_name, form.customer_name.trim()],
      ['phone', order.phone, phone],
      ['email', order.email, form.email.trim().toLowerCase()],
      ['address', order.address, form.address.trim()],
      ['barangay', order.barangay, form.barangay.trim()],
      ['city', order.city, form.city.trim()],
      ['landmark', order.landmark, form.landmark.trim() || null],
      ['delivery_date', order.delivery_date, form.delivery_date],
      ['delivery_slot', order.delivery_slot, form.delivery_slot],
      ['payment_method', order.payment_method, form.payment_method],
      ['subtotal', Number(order.subtotal).toFixed(2), (subtotalCents / 100).toFixed(2)],
      ['delivery_fee', Number(order.delivery_fee).toFixed(2), (feeCents / 100).toFixed(2)],
      ['total', Number(order.total).toFixed(2), (totalCents / 100).toFixed(2)],
    ]
    for (const [field, from, to] of fields) if ((from ?? null) !== (to ?? null)) out.push({ field, from, to })
    return out
  }, [order, form, items, lines, views, subtotalCents, feeCents, totalCents])

  const dirty = changes.length > 0
  const [leaveTo, setLeaveTo] = useState<string | null>(null)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    // Links inside the admin (sidebar, mobile menu) ask before the unsaved changes are lost.
    const onClick = (e: MouseEvent) => {
      if (saved.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.origin !== window.location.origin) return
      if (a.pathname === window.location.pathname) return
      e.preventDefault()
      e.stopPropagation()
      setLeaveTo(a.pathname + a.search + a.hash)
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])

  if (missing) return <EmptyState title="Order not found" action={<Button asChild><Link to="/admin/orders">Back to orders</Link></Button>} />
  if (!order || !form || cat.loading) {
    return loadError ? <ErrorBanner>{loadError}</ErrorBanner> : (
      <div className="space-y-3">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const o = order
  const backTo = `/admin/orders/${o.id}`

  if (o.order_status === 'cancelled') {
    return (
      <EmptyState
        icon={<Ban />}
        title="Cancelled orders can't be edited"
        action={<Button asChild><Link to={backTo}><ArrowLeft /> Back to {o.order_number}</Link></Button>}
      >
        {o.order_number} was cancelled{o.cancel_reason ? ` (${o.cancel_reason})` : ''}. Editing it could reopen an order the customer already knows is cancelled.
      </EmptyState>
    )
  }

  const scheduleOpen = SCHEDULE_OPEN.includes(o.order_status)
  const lockReason = o.order_status === 'delivered' ? 'This order was already delivered' : 'The rider is already on the way'
  const paymentOpen = o.order_status === 'processing' && o.payment_status !== 'paid'
  const itemsChanged = changes.some((c) => c.field === 'item') || lines.some((l, i) => l.id !== (items[i]?.id ?? null))
  const amountChanged = changes.some((c) => c.field === 'total' || c.field === 'subtotal' || c.field === 'delivery_fee')
  const scheduleChanged = changes.some((c) => c.field === 'delivery_date' || c.field === 'delivery_slot')
  const subtotalDiff = subtotalCents - toCents(o.subtotal)
  const paidCents = toCents(o.paid_amount ?? o.subtotal)
  const paidDiff = subtotalCents - paidCents
  const removed = items.filter((i) => !lines.some((l) => l.id === i.id))
  const slotOptions = slotInfo.slots.some((s) => s.value === form.delivery_slot)
    ? slotInfo.slots
    : [{ value: form.delivery_slot, label: `${slotLabel(form.delivery_slot)} (outside store hours)` }, ...slotInfo.slots]
  const today = manilaNow().date
  const dateBlocked = blockedDates.includes(form.delivery_date)

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }
  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    setErrors((e) => ({ ...e, items: undefined }))
  }

  function validate(): Errors {
    const f = form!
    const e: Errors = {}
    if (f.customer_name.trim().length < 2) e.customer_name = 'Please enter the customer\'s full name.'
    if (!normalizePhone(f.phone)) e.phone = 'Enter a PH mobile number (09XXXXXXXXX or +639XXXXXXXXX).'
    if (!isValidEmail(f.email)) e.email = 'Enter a valid email address.'
    if (f.address.trim().length < 4) e.address = 'Enter the house/unit number and street.'
    if (f.barangay.trim().length < 2) e.barangay = 'Enter the barangay.'
    if (f.city.trim().length < 2) e.city = 'Enter the city.'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.delivery_date)) e.delivery_date = 'Choose a delivery date.'
    else if (f.delivery_date !== o.delivery_date && f.delivery_date < today) e.delivery_date = 'The delivery date cannot be in the past.'
    else if (f.delivery_date !== o.delivery_date && f.delivery_date === today) e.delivery_date = 'Same day delivery is not available. Choose tomorrow or later.'
    else if (f.delivery_date !== o.delivery_date && blockedDates.includes(f.delivery_date)) e.delivery_date = 'This date is blocked in Settings. Choose another date.'
    if ((itemsChanged || f.delivery_slot !== o.delivery_slot) && scheduleOpen) {
      if (slotInfo.conflict) e.delivery_slot = slotInfo.conflict
      else if (!slotInfo.slots.some((s) => s.value === f.delivery_slot)) e.delivery_slot = 'Choose a time slot inside the store hours.'
    }
    if (!feeValid) e.delivery_fee = 'Enter a delivery fee from ₱0 to ₱100,000.'
    if (lines.length === 0) e.items = 'An order needs at least one item. To drop everything, cancel the order instead.'
    else {
      const bad = views.find((v) => v.error)
      if (bad) e.items = `${bad.productName}: ${bad.error}`
    }
    if (f.payment_method === 'cod' && subtotalCents > toCents(COD_MAX) && (subtotalCents !== toCents(o.subtotal) || f.payment_method !== o.payment_method)) {
      e.payment_method = `Cash on Delivery is only for orders up to ${COD_MAX_LABEL}. Switch to an online payment or remove some items.`
    }
    return e
  }

  function onSave() {
    const e = validate()
    setErrors(e)
    if (Object.values(e).some(Boolean)) {
      setSaveError(null)
      toast.error('Please fix the highlighted fields.')
      requestAnimationFrame(() => document.querySelector('[data-field-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      return
    }
    if (!dirty) return toast('There are no changes to save.')
    // Changes to the amount, schedule or payment are reviewed first.
    if (amountChanged || scheduleChanged || form!.payment_method !== o.payment_method) setConfirmOpen(true)
    else void save()
  }

  async function save() {
    const f = form!
    setSaving(true)
    setSaveError(null)
    const { error } = await supabase.rpc('admin_edit_order', {
      p_order_id: o.id,
      p_expected_updated_at: o.updated_at,
      p_changes: {
        customer_name: f.customer_name,
        phone: f.phone,
        email: f.email,
        address: f.address,
        barangay: f.barangay,
        city: f.city,
        landmark: f.landmark,
        delivery_date: f.delivery_date,
        delivery_slot: f.delivery_slot,
        delivery_fee: feeNumber,
        payment_method: f.payment_method,
        items: lines.map((l) =>
          l.id
            ? { id: l.id, variant_id: l.variantId, quantity: l.quantity }
            : { variant_id: l.variantId, quantity: l.quantity, choice_ids: l.choiceIds, extra_toppings: l.extraToppings },
        ),
      },
    })
    setSaving(false)
    setConfirmOpen(false)
    if (error) {
      const msg = /admin_edit_order|schema cache/i.test(error.message)
        ? `Edit Order needs a database update. Run ${MIGRATION} in Supabase → SQL Editor, then try again.`
        : errorMessage(error)
      setSaveError(msg)
      if (/updated while you were editing/i.test(msg)) setStale(true)
      toast.error(msg)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    saved.current = true
    toast.success(`${o.order_number} updated`, { description: 'The customer\'s tracking page shows the changes.' })
    navigate(backTo)
  }

  const cancelEdit = () => (dirty ? setDiscardOpen(true) : navigate(backTo))
  const discardTo = leaveTo ?? backTo

  const actions = (
    <>
      <Button size="lg" className="w-full" onClick={onSave} loading={saving} disabled={!dirty}>
        <Save /> Save changes
      </Button>
      <Button size="md" variant="outline" className="w-full" onClick={cancelEdit} disabled={saving}>
        Cancel
      </Button>
    </>
  )

  return (
    <div className="space-y-5 pb-28 lg:pb-0">
      <button type="button" onClick={cancelEdit} className="inline-flex items-center gap-1 text-sm font-semibold text-navy/60 hover:text-brand-600">
        <ArrowLeft className="size-4" /> {o.order_number}
      </button>
      <AdminPageHeader title="Edit order" description={`${o.order_number} · ${o.customer_name}`} />

      {stale && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center">
          <AlertTriangle className="size-5 shrink-0" />
          <p className="min-w-0 flex-1">This order changed while you were editing (for example its status or payment). Reload to edit the latest version. Your unsaved changes will be lost.</p>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => void load()}>
            <RotateCcw /> Reload latest
          </Button>
        </div>
      )}
      {o.cancel_requested && (
        <div className="rounded-2xl border-2 border-brand-red/40 bg-red-50 p-4 text-sm">
          <p className="font-heading font-bold text-red-800">The customer asked to cancel this order</p>
          {o.cancel_request_reason && <p className="mt-0.5 break-words text-red-900/80">“{o.cancel_request_reason}”</p>}
          <p className="mt-1 text-red-900/80">Check with them before editing. To cancel or decline the request, go back to the order page.</p>
        </div>
      )}
      {saveError && !stale && <ErrorBanner>{saveError} Your changes are still here, nothing was saved.</ErrorBanner>}
      {errors && Object.values(errors).some(Boolean) && !saveError && (
        <ErrorBanner>Some fields need fixing before you can save. They are highlighted below.</ErrorBanner>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          {/* 1. Order information */}
          <Panel title="Order information">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Fact label="Order number"><span className="font-mono font-semibold">{o.order_number}</span></Fact>
              <Fact label="Placed">{formatDateTime(o.created_at)}</Fact>
              <Fact label="Status"><OrderBadges order={o} /></Fact>
              <Fact label="Tracking link">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline"
                  onClick={async () => (await copyText(trackingUrl(o.tracking_token))) && toast.success('Customer tracking link copied')}
                >
                  <Copy className="size-4" /> Copy link
                </button>
              </Fact>
              <Fact label="Stores" className="sm:col-span-2">
                {orderStores.length ? orderStores.map((s) => s.name).join(', ') : 'None yet'}
              </Fact>
            </dl>
            <p className="mt-3 text-xs text-navy/55">The order number, tracking link, status and payment records stay the same when you save.</p>
          </Panel>

          {/* 2. Customer details */}
          <Panel title="Customer details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer name" htmlFor="ed-name" required error={errors.customer_name} className="sm:col-span-2">
                <Input id="ed-name" value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} maxLength={120} autoComplete="off" aria-invalid={!!errors.customer_name} />
              </Field>
              <Field label="Contact number" htmlFor="ed-phone" required error={errors.phone}>
                <Input id="ed-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={20} placeholder="09XXXXXXXXX" aria-invalid={!!errors.phone} />
              </Field>
              <Field label="Email address" htmlFor="ed-email" required error={errors.email}>
                <Input id="ed-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={200} aria-invalid={!!errors.email} />
              </Field>
            </div>
          </Panel>

          {/* 3. Delivery information */}
          <Panel title="Delivery information">
            {!scheduleOpen && <LockNote>{lockReason}, so the date and time slot are locked. The address can still be corrected.</LockNote>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Delivery date"
                htmlFor="ed-date"
                required
                error={errors.delivery_date}
                hint={form.delivery_date !== o.delivery_date ? `Was ${formatDate(o.delivery_date)}` : dateBlocked ? 'This date is blocked in Settings.' : undefined}
              >
                <Input
                  id="ed-date"
                  type="date"
                  value={form.delivery_date}
                  min={form.delivery_date <= today ? undefined : addDays(today, 1)}
                  onChange={(e) => set('delivery_date', e.target.value)}
                  disabled={!scheduleOpen}
                  aria-invalid={!!errors.delivery_date}
                />
              </Field>
              <Field
                label="Time slot"
                htmlFor="ed-slot"
                required
                error={errors.delivery_slot}
                hint={slotInfo.window ? `Stores in this order deliver ${formatHours(slotInfo.window.open, slotInfo.window.close)}.` : undefined}
              >
                <NativeSelect id="ed-slot" value={form.delivery_slot} onChange={(e) => set('delivery_slot', e.target.value)} disabled={!scheduleOpen} aria-invalid={!!errors.delivery_slot}>
                  {slotOptions.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="House/unit and street" htmlFor="ed-address" required error={errors.address} className="sm:col-span-2">
                <Textarea id="ed-address" rows={2} className="min-h-0 resize-y" value={form.address} onChange={(e) => set('address', e.target.value)} maxLength={300} aria-invalid={!!errors.address} />
              </Field>
              <Field label="Barangay" htmlFor="ed-barangay" required error={errors.barangay}>
                <Input id="ed-barangay" value={form.barangay} onChange={(e) => set('barangay', e.target.value)} maxLength={120} aria-invalid={!!errors.barangay} />
              </Field>
              <Field label="City" htmlFor="ed-city" required error={errors.city}>
                <Input id="ed-city" value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={120} aria-invalid={!!errors.city} />
              </Field>
              <Field label="Landmark" htmlFor="ed-landmark" optional className="sm:col-span-2">
                <Textarea id="ed-landmark" rows={2} className="min-h-0 resize-y" value={form.landmark} onChange={(e) => set('landmark', e.target.value)} maxLength={200} placeholder="e.g. Blue gate beside the chapel" />
              </Field>
            </div>
          </Panel>

          {/* 4. Order items */}
          <Panel
            title="Order items"
            actions={scheduleOpen && (
              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus /> Add product
              </Button>
            )}
          >
            {!scheduleOpen && <LockNote>{lockReason}, so the items are locked.</LockNote>}
            <div data-field-error={errors.items ? 'true' : undefined}>
              {errors.items && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-brand-red">{errors.items}</p>}
              {lines.length === 0 ? (
                <p className="rounded-xl border border-dashed border-sand-200 px-4 py-6 text-center text-sm text-navy/60">No items. Add a product to keep this order.</p>
              ) : (
                <ul className="space-y-3">
                  {lines.map((l, idx) => {
                    const v = views[idx]
                    const o2 = l.id ? original.get(l.id) : undefined
                    const sizes = cat.variantsByProduct.get(l.productId) ?? []
                    const edited = o2 && (o2.variant_id !== l.variantId || o2.quantity !== l.quantity)
                    const optionText = v.options.map((x) => (x.group === 'Extra Toppings' ? 'Extra toppings' : `${x.group}: ${x.choice}`)).join(' · ')
                    return (
                      <li key={l.key} className={cn('rounded-xl p-3 ring-1 sm:p-4', v.error ? 'ring-brand-red/40 bg-red-50/40' : 'ring-sand-200/70')}>
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                              <span className="min-w-0 break-words">{v.productName}</span>
                              {!l.id && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">New</span>}
                              {edited && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-ink">Edited</span>}
                            </p>
                            <p className="break-words text-xs text-navy/60">
                              {v.storeName}
                              {optionText && ` · ${optionText}`}
                            </p>
                          </div>
                          {scheduleOpen && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="shrink-0 text-brand-red hover:bg-red-50"
                              aria-label={`Remove ${v.productName}`}
                              title="Remove item"
                              onClick={() => {
                                setLines((ls) => ls.filter((x) => x.key !== l.key))
                                setErrors((e) => ({ ...e, items: undefined }))
                              }}
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(7rem,auto)]">
                          <div className="col-span-2 min-w-0 sm:col-span-1">
                            {sizes.length > 1 ? (
                              <Field label="Size" htmlFor={`size-${l.key}`}>
                                <NativeSelect
                                  id={`size-${l.key}`}
                                  value={l.variantId}
                                  disabled={!scheduleOpen}
                                  onChange={(e) => updateLine(l.key, { variantId: e.target.value })}
                                >
                                  {!sizes.some((s) => s.id === l.variantId) && <option value={l.variantId}>{v.variantLabel}</option>}
                                  {sizes.map((s) => (
                                    <option key={s.id} value={s.id} disabled={s.is_sold_out && s.id !== l.variantId}>
                                      {s.label} · {peso(s.price)}{s.is_sold_out ? ' (sold out)' : ''}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </Field>
                            ) : (
                              <p className="text-sm text-navy/70">
                                {v.variantLabel && v.variantLabel !== 'Regular' ? <>Size: <span className="font-semibold text-navy">{v.variantLabel}</span></> : 'One size'}
                              </p>
                            )}
                          </div>
                          <div>
                            <p className="mb-1.5 text-sm font-semibold">Quantity</p>
                            <QuantityStepper value={l.quantity} onChange={(n) => updateLine(l.key, { quantity: n })} disabled={!scheduleOpen} />
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-navy/60">{peso(v.unitCents / 100)} each</p>
                            <p className="font-heading text-base font-bold tabular-nums">{peso((v.unitCents * l.quantity) / 100)}</p>
                          </div>
                        </div>
                        {v.error && <p className="mt-2 text-xs font-medium text-brand-red">{v.error}</p>}
                      </li>
                    )
                  })}
                </ul>
              )}
              {removed.length > 0 && (
                <div className="mt-4 rounded-xl bg-sand/50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-navy/55">Removed on save</p>
                  <ul className="mt-2 space-y-2">
                    {removed.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 break-words text-navy/60 line-through decoration-navy/30">
                          {lineText(i.quantity, i.product_name_snapshot, i.variant_label_snapshot, i.options_snapshot)}
                        </span>
                        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setLines((ls) => [...ls, lineFromItem(i)])}>
                          <RotateCcw /> Undo
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* 5. Payment and pricing + 6. Save / Cancel */}
        <div className="min-w-0">
          <div className="space-y-5 lg:sticky lg:top-6">
            <Panel title="Payment and pricing">
              <div className="space-y-4">
                <Field
                  label="Payment method"
                  htmlFor="ed-method"
                  error={errors.payment_method}
                  hint={
                    !paymentOpen
                      ? 'Locked: the payment can only change before the order is confirmed and paid.'
                      : form.payment_method !== o.payment_method
                        ? form.payment_method === 'cod'
                          ? 'The order becomes Cash on Delivery (unpaid).'
                          : o.payment_method === 'cod'
                            ? 'The customer is asked to upload their payment screenshot on the tracking page. Confirm the order after you check it.'
                            : 'The reference number and screenshot stay on the order.'
                        : undefined
                  }
                >
                  <NativeSelect
                    id="ed-method"
                    value={form.payment_method}
                    disabled={!paymentOpen}
                    onChange={(e) => set('payment_method', e.target.value as PaymentMethod)}
                    aria-invalid={!!errors.payment_method}
                  >
                    {(['cod', ...ONLINE_METHODS] as PaymentMethod[]).map((m) => (
                      <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
                    ))}
                  </NativeSelect>
                </Field>

                <div className="space-y-2 rounded-xl bg-cream p-3 text-sm">
                  <Row label="Food subtotal" value={peso(subtotalCents / 100)} was={subtotalDiff !== 0 ? peso(o.subtotal) : undefined} />
                  <Field label="Delivery fee (₱)" htmlFor="ed-fee" error={errors.delivery_fee} className="pt-1">
                    <Input
                      id="ed-fee"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100000}
                      step="0.01"
                      value={form.delivery_fee}
                      onChange={(e) => set('delivery_fee', e.target.value)}
                      aria-invalid={!!errors.delivery_fee}
                    />
                  </Field>
                  <div className="flex items-baseline justify-between gap-3 border-t border-dashed border-navy/15 pt-2 font-heading text-lg font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">{peso(totalCents / 100)}</span>
                  </div>
                  <p className="text-xs text-navy/55">Total = food subtotal + delivery fee. It is calculated for you and can't be typed in.</p>
                </div>

                {o.payment_method !== 'cod' && o.payment_status === 'paid' && paidDiff !== 0 && (
                  <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      The customer paid {peso(paidCents / 100)} for the food. After saving there is a {paidDiff > 0 ? `balance due of ${peso(paidDiff / 100)}` : `refund due of ${peso(-paidDiff / 100)}`}. It shows on the order page until you mark it settled.
                    </span>
                  </p>
                )}
              </div>
            </Panel>

            <div className="hidden space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sand-200/70 lg:block">
              <p className="text-sm text-navy/60">{dirty ? `${changes.length} unsaved ${changes.length === 1 ? 'change' : 'changes'}` : 'No changes yet'}</p>
              {actions}
            </div>
          </div>
        </div>
      </div>

      {/* Phones and tablets: Save / Cancel always in reach */}
      <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-sand-200/70 bg-white/95 px-3 py-3 shadow-[0_-8px_24px_rgba(13,43,78,0.08)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-navy/60">{dirty ? `${changes.length} unsaved ${changes.length === 1 ? 'change' : 'changes'}` : 'No changes yet'}</p>
            <p className="font-heading text-lg font-bold tabular-nums">{peso(totalCents / 100)}</p>
          </div>
          <Button variant="outline" onClick={cancelEdit} disabled={saving} className="shrink-0">Cancel</Button>
          <Button onClick={onSave} loading={saving} disabled={!dirty} className="shrink-0">
            <Save /> Save
          </Button>
        </div>
      </div>

      {/* Review before saving changes to the amount, schedule or payment */}
      <Dialog open={confirmOpen} onOpenChange={(open) => !saving && setConfirmOpen(open)}>
        <DialogContent className="max-w-xl">
          <DialogTitle>Save these changes?</DialogTitle>
          <DialogDescription>
            {[amountChanged && 'the amount', scheduleChanged && 'the delivery schedule', form.payment_method !== o.payment_method && 'the payment method']
              .filter(Boolean)
              .join(', ')
              .replace(/, ([^,]*)$/, ' and $1')
              .replace(/^./, (c) => c.toUpperCase())}{' '}
            will change. The customer sees the updated order on their tracking page.
          </DialogDescription>
          <ul className="mt-4 max-h-[45dvh] space-y-1.5 overflow-y-auto rounded-xl bg-cream p-3">
            {changes.map((c, i) => (
              <ChangeLine key={i} change={c} />
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>Back</Button>
            <Button onClick={() => void save()} loading={saving}>
              <Save /> Save changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={discardOpen || leaveTo !== null}
        onOpenChange={(open) => {
          if (open) return
          setDiscardOpen(false)
          setLeaveTo(null)
        }}
      >
        <DialogContent>
          <DialogTitle>Discard your changes?</DialogTitle>
          <DialogDescription>You have {changes.length} unsaved {changes.length === 1 ? 'change' : 'changes'}. The order stays as it was.</DialogDescription>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDiscardOpen(false)
                setLeaveTo(null)
              }}
            >
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                saved.current = true
                navigate(discardTo)
              }}
            >
              Discard changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AddProductDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        catalog={cat}
        onAdd={(line) => {
          setLines((ls) => {
            const same = ls.find(
              (x) => !x.id && x.variantId === line.variantId && x.extraToppings === line.extraToppings && [...x.choiceIds].sort().join() === [...line.choiceIds].sort().join(),
            )
            if (same) return ls.map((x) => (x === same ? { ...x, quantity: Math.min(99, x.quantity + line.quantity) } : x))
            return [...ls, { ...line, key: randomId(), id: null }]
          })
          setErrors((e) => ({ ...e, items: undefined }))
          toast.success('Product added. Save to keep it.')
        }}
      />
    </div>
  )
}

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-navy/55">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  )
}

function Row({ label, value, was }: { label: string; value: string; was?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className="text-right">
        {was && <span className="mr-2 text-xs text-navy/50 line-through">{was}</span>}
        <span className="font-semibold tabular-nums">{value}</span>
      </span>
    </div>
  )
}

function LockNote({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 flex gap-2 rounded-xl bg-sand/60 px-3 py-2 text-sm text-navy/70">
      <Lock className="mt-0.5 size-4 shrink-0" /> <span>{children}</span>
    </p>
  )
}

// ---------------------------------------------------------------------
// Add a product: search the menu, then pick size, options and quantity.
// ---------------------------------------------------------------------
function AddProductDialog({
  open,
  onOpenChange,
  catalog: cat,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  catalog: Catalog
  onAdd: (line: Omit<Line, 'key' | 'id'>) => void
}) {
  const [query, setQuery] = useState('')
  const [storeId, setStoreId] = useState('')
  const [product, setProduct] = useState<Product | null>(null)
  const [variantId, setVariantId] = useState('')
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [extra, setExtra] = useState(false)
  const [qty, setQty] = useState(1)

  useEffect(() => {
    if (open) return
    setProduct(null)
    setQuery('')
  }, [open])

  const LIMIT = 40
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cat.products.filter((p) => {
      if (storeId && p.store_id !== storeId) return false
      if (!q) return true
      const store = cat.storeById.get(p.store_id)
      return p.name.toLowerCase().includes(q) || (store?.name.toLowerCase().includes(q) ?? false)
    })
  }, [cat.products, cat.storeById, query, storeId])

  function pick(p: Product) {
    const sizes = cat.variantsByProduct.get(p.id) ?? []
    setProduct(p)
    setVariantId((sizes.find((v) => !v.is_sold_out) ?? sizes[0])?.id ?? '')
    setChoices({})
    setExtra(false)
    setQty(1)
  }

  const sizes = product ? (cat.variantsByProduct.get(product.id) ?? []) : []
  const variant = cat.variantById.get(variantId)
  const groups = product ? (cat.groupsByProduct.get(product.id) ?? []) : []
  const missing = groups.find((g) => g.is_required && !choices[g.id])
  let unitCents = variant ? toCents(variant.price) : 0
  if (variant && extra && variant.addon_price !== null) unitCents += toCents(variant.addon_price)
  for (const g of groups) {
    const c = (cat.choicesByGroup.get(g.id) ?? []).find((x) => x.id === choices[g.id])
    if (c) unitCents += toCents(c.price_delta)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {!product ? (
          <>
            <DialogTitle>Add a product</DialogTitle>
            <DialogDescription>Search the menu. Prices come from the menu and can't be changed.</DialogDescription>
            <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy/40" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Product or store name" className="pl-9" autoFocus aria-label="Search products" />
              </div>
              <NativeSelect value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Store">
                <option value="">All stores</option>
                {cat.stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </NativeSelect>
            </div>
            <ul className="mt-3 max-h-[50dvh] divide-y divide-sand overflow-y-auto rounded-xl ring-1 ring-sand-200/70">
              {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-navy/60">No products match.</li>}
              {results.slice(0, LIMIT).map((p) => {
                const store = cat.storeById.get(p.store_id)
                const vs = cat.variantsByProduct.get(p.id) ?? []
                const from = Math.min(...vs.map((v) => v.price))
                const unavailable = p.is_sold_out || vs.every((v) => v.is_sold_out) ? 'Sold out' : store && !store.is_accepting_orders ? 'Store paused' : null
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={!!unavailable}
                      onClick={() => pick(p)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-semibold">{p.name}</span>
                        <span className="block break-words text-xs text-navy/60">
                          {store?.name}
                          {vs.length > 1 && ` · ${vs.length} sizes`}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-sm">
                        {unavailable ? (
                          <span className="text-xs font-semibold text-brand-red">{unavailable}</span>
                        ) : (
                          <span className="font-semibold tabular-nums">{vs.length > 1 ? `from ${peso(from)}` : peso(from)}</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {results.length > LIMIT && <p className="mt-2 text-xs text-navy/55">Showing {LIMIT} of {results.length}. Type more of the name or pick a store to narrow it down.</p>}
          </>
        ) : (
          <>
            <DialogTitle className="break-words">{product.name}</DialogTitle>
            <DialogDescription>{cat.storeById.get(product.store_id)?.name}</DialogDescription>
            <div className="mt-4 space-y-4">
              {sizes.length > 1 && (
                <div>
                  <p className="mb-2 text-sm font-semibold">Size</p>
                  <div className="flex flex-wrap gap-2">
                    {sizes.map((v) => (
                      <Chip key={v.id} selected={v.id === variantId} disabled={v.is_sold_out} onClick={() => setVariantId(v.id)}>
                        {v.label} · {peso(v.price)}
                        {v.is_sold_out && ' (sold out)'}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
              {groups.map((g) => (
                <div key={g.id}>
                  <p className="mb-2 text-sm font-semibold">
                    {g.name}
                    {g.is_required ? <span className="ml-0.5 text-brand-red">*</span> : <span className="ml-1.5 text-xs font-normal text-navy/50">(optional)</span>}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(cat.choicesByGroup.get(g.id) ?? []).map((c) => (
                      <Chip
                        key={c.id}
                        selected={choices[g.id] === c.id}
                        onClick={() => setChoices((s) => ({ ...s, [g.id]: s[g.id] === c.id && !g.is_required ? '' : c.id }))}
                      >
                        {c.label}
                        {Number(c.price_delta) > 0 && ` +${peso(c.price_delta)}`}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}
              {variant && variant.addon_price !== null && (
                <label className="flex items-center gap-3 rounded-xl bg-cream px-3 py-2.5 text-sm">
                  <Checkbox checked={extra} onCheckedChange={(v) => setExtra(v === true)} />
                  <span className="flex-1 font-semibold">Extra toppings</span>
                  <span className="tabular-nums">+{peso(variant.addon_price)}</span>
                </label>
              )}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="mb-1.5 text-sm font-semibold">Quantity</p>
                  <QuantityStepper value={qty} onChange={setQty} />
                </div>
                <div className="text-right">
                  <p className="text-xs text-navy/60">{peso(unitCents / 100)} each</p>
                  <p className="font-heading text-xl font-bold tabular-nums">{peso((unitCents * qty) / 100)}</p>
                </div>
              </div>
            </div>
            {missing && <p className="mt-3 text-sm text-navy/65">Choose a {missing.name.toLowerCase()} to continue.</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setProduct(null)}>
                <ArrowLeft /> Back
              </Button>
              <Button
                disabled={!variant || variant.is_sold_out || !!missing}
                onClick={() => {
                  onAdd({
                    productId: product.id,
                    variantId,
                    quantity: qty,
                    choiceIds: Object.values(choices).filter(Boolean),
                    extraToppings: extra && variant?.addon_price !== null,
                  })
                  onOpenChange(false)
                }}
              >
                <Plus /> Add to order
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
