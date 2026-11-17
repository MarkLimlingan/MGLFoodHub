import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Check, ImagePlus, Lock, Pencil, Search, Trash2, X } from 'lucide-react'
import { useCatalog } from '@/hooks/useCatalog'
import { errorMessage, rpc, uploadImage } from '@/lib/api'
import { prepareImage } from '@/lib/image'
import type { Badge, Product, Store, Variant } from '@/lib/types'
import { cn, formatHours, peso } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Skeleton, Switch } from '@/components/ui/controls'
import { BADGE_LABEL, SmartImage } from '@/components/common'
import { AdminPageHeader, Panel } from './ui'

async function upload(bucket: 'product-images' | 'store-assets', folder: string, file: File): Promise<string> {
  const img = await prepareImage(file, 1600)
  return uploadImage(bucket, folder, img)
}

export default function Products() {
  const cat = useCatalog()
  const [storeId, setStoreId] = useState<string>('')
  const [filter, setFilter] = useState('')
  const store = cat.storeById.get(storeId) ?? cat.stores[0]

  if (cat.loading) return <Skeleton className="h-96" />

  return (
    <div>
      <AdminPageHeader
        title="Products & stores"
        description={
          <span className="inline-flex items-center gap-1">
            <Lock className="size-3.5" /> Names and variants are fixed. You can edit prices, availability, badges, photos and order.
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Panel title="Stores" className="h-fit lg:sticky lg:top-6">
          <ul className="space-y-1.5">
            {cat.stores.map((s) => (
              <li
                key={s.id}
                className={cn('flex items-center gap-2 rounded-xl border px-2.5 py-2 transition', store?.id === s.id ? 'border-brand bg-brand-50' : 'border-transparent hover:bg-cream')}
              >
                <button type="button" onClick={() => setStoreId(s.id)} className="min-w-0 flex-1 text-left">
                  <p className="break-words text-sm font-semibold leading-snug">{s.name}</p>
                  <p className={cn('text-xs', s.is_accepting_orders ? 'text-emerald-700' : 'text-brand-red')}>
                    {s.is_accepting_orders ? 'Accepting orders' : 'Temporarily unavailable'}
                  </p>
                </button>
                <StoreToggle store={s} />
              </li>
            ))}
          </ul>
        </Panel>

        {store && (
          <div className="space-y-5">
            <StoreAssets store={store} />
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy/40" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Search ${store.name} products`} className="pl-9" />
            </div>
            {(cat.sectionsByStore.get(store.id) ?? []).map((section) => {
              const products = (cat.productsBySection.get(section.id) ?? []).filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))
              if (!products.length) return null
              return (
                <Panel key={section.id} title={section.name}>
                  <ul className="divide-y divide-sand">
                    {products.map((p, i) => (
                      <ProductRow key={p.id} product={p} prev={products[i - 1]} next={products[i + 1]} reorderable={!filter} />
                    ))}
                  </ul>
                </Panel>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StoreToggle({ store }: { store: Store }) {
  const cat = useCatalog()
  return (
    <Switch
      checked={store.is_accepting_orders}
      aria-label={`${store.name} accepting orders`}
      onCheckedChange={async (v) => {
        cat.patch('stores', store.id, { is_accepting_orders: v })
        const { error } = await rpc('admin_update_store', { id: store.id, values: { is_accepting_orders: v } })
        if (error) {
          cat.patch('stores', store.id, { is_accepting_orders: !v })
          toast.error(errorMessage(error))
        } else toast.success(`${store.name} is now ${v ? 'accepting orders' : 'temporarily unavailable'}`)
      }}
    />
  )
}

function StoreAssets({ store }: { store: Store }) {
  const cat = useCatalog()
  const [busy, setBusy] = useState<string | null>(null)
  const replace = async (field: 'cover_image_url' | 'menu_image_url', file: File) => {
    setBusy(field)
    try {
      const url = await upload('store-assets', store.slug, file)
      const { error } = await rpc('admin_update_store', { id: store.id, values: { [field]: url } })
      if (error) throw error
      cat.patch('stores', store.id, { [field]: url })
      toast.success('Image updated')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <Panel title={store.name}>
      <p className="-mt-2 mb-3 text-sm text-navy/60">Hours: {formatHours(store.open_time, store.close_time)}</p>
      <div className="grid grid-cols-2 gap-3">
        {(['cover_image_url', 'menu_image_url'] as const).map((field) => (
          <label key={field} className="group relative block cursor-pointer overflow-hidden rounded-xl border border-sand-200">
            <SmartImage src={store[field]} alt="" className="aspect-[16/10] w-full" />
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-navy/80 py-1.5 text-xs font-semibold text-white">
              <ImagePlus className="size-3.5" /> {busy === field ? 'Uploading…' : `Replace ${field === 'cover_image_url' ? 'cover' : 'menu photo'}`}
            </span>
            <input type="file" accept="image/*" className="sr-only" disabled={!!busy} onChange={(e) => e.target.files?.[0] && void replace(field, e.target.files[0])} />
          </label>
        ))}
      </div>
    </Panel>
  )
}

function ProductRow({ product: p, prev, next, reorderable }: { product: Product; prev?: Product; next?: Product; reorderable: boolean }) {
  const cat = useCatalog()
  const variants = cat.variantsByProduct.get(p.id) ?? []
  const groups = cat.groupsByProduct.get(p.id) ?? []
  const [busy, setBusy] = useState(false)
  const choicesText = useMemo(
    () => groups.map((g) => `${g.name}: ${(cat.choicesByGroup.get(g.id) ?? []).map((c) => c.label).join(' / ')}`).join(' · '),
    [groups, cat.choicesByGroup],
  )

  const updateProduct = async (values: Partial<Pick<Product, 'is_sold_out' | 'badge' | 'image_url' | 'sort'>>, id = p.id, undo?: Partial<Product>) => {
    cat.patch('products', id, values)
    const { error } = await rpc('admin_update_product', { id, values })
    if (error) {
      if (undo) cat.patch('products', id, undo)
      toast.error(errorMessage(error))
      return false
    }
    return true
  }

  const swap = async (other: Product) => {
    setBusy(true)
    const a = p.sort
    const b = other.sort === a ? a + (other === next ? 1 : -1) : other.sort
    await updateProduct({ sort: b }, p.id, { sort: a })
    await updateProduct({ sort: a }, other.id, { sort: other.sort })
    setBusy(false)
  }

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 py-3 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
      <label className="group relative size-20 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-sand-200" title="Upload / replace photo">
        <SmartImage src={p.image_url} alt={p.name} className="size-full" />
        <span className="absolute inset-0 flex items-center justify-center bg-navy/60 text-white opacity-0 transition group-hover:opacity-100">
          <ImagePlus className="size-5" />
        </span>
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              toast.loading('Uploading photo…', { id: p.id })
              const url = await upload('product-images', p.id, f)
              if (await updateProduct({ image_url: url })) toast.success('Photo updated', { id: p.id })
              else toast.dismiss(p.id)
            } catch (err) {
              toast.error(errorMessage(err), { id: p.id })
            }
          }}
        />
      </label>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn('font-semibold', p.is_sold_out && 'text-navy/45 line-through')}>{p.name}</p>
          {p.is_sold_out && <span className="rounded-full bg-brand-red px-2 py-0.5 text-[10px] font-bold text-white">SOLD OUT</span>}
        </div>
        {choicesText && <p className="text-xs text-navy/55">{choicesText}</p>}
        <ul className="flex flex-wrap gap-1.5">
          {variants.map((v) => (
            <VariantChip key={v.id} productName={p.name} variant={v} showToggle={variants.length > 1} />
          ))}
        </ul>
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-2 xl:col-span-1 xl:flex-col xl:items-end">
        <label className="flex items-center gap-2 text-xs font-semibold">
          {p.is_sold_out ? 'Sold out' : 'Available'}
          <Switch
            checked={!p.is_sold_out}
            aria-label={`${p.name} available`}
            onCheckedChange={(avail) => void updateProduct({ is_sold_out: !avail }, p.id, { is_sold_out: avail })}
          />
        </label>
        <NativeSelect
          value={p.badge ?? ''}
          onChange={(e) => void updateProduct({ badge: (e.target.value || null) as Badge | null }, p.id, { badge: p.badge })}
          className="h-9 w-44 text-sm"
          aria-label="Badge"
        >
          <option value="">No badge</option>
          {Object.entries(BADGE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </NativeSelect>
        <div className="flex gap-1">
          {reorderable && (
            <>
              <Button variant="outline" size="icon-sm" disabled={!prev || busy} onClick={() => prev && void swap(prev)} aria-label="Move up">
                <ArrowUp />
              </Button>
              <Button variant="outline" size="icon-sm" disabled={!next || busy} onClick={() => next && void swap(next)} aria-label="Move down">
                <ArrowDown />
              </Button>
            </>
          )}
          {p.image_url && (
            <Button variant="outline" size="icon-sm" aria-label="Remove photo" onClick={() => confirm('Remove this photo?') && void updateProduct({ image_url: null }, p.id, { image_url: p.image_url })}>
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

function parsePrice(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null
  return Math.round(n * 100) / 100
}

function VariantChip({ productName, variant: v, showToggle }: { productName: string; variant: Variant; showToggle: boolean }) {
  const cat = useCatalog()
  const [editing, setEditing] = useState(false)
  const [priceText, setPriceText] = useState('')
  const [addonText, setAddonText] = useState('')
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    setPriceText(v.price.toFixed(2))
    setAddonText(v.addon_price !== null ? v.addon_price.toFixed(2) : '')
    setEditing(true)
  }

  const cancel = () => {
    if (!saving) setEditing(false)
  }

  const save = async () => {
    const nextPrice = parsePrice(priceText)
    if (nextPrice === null) {
      toast.error('Please enter a valid price (0 to 1,000,000).')
      return
    }
    let nextAddon = v.addon_price
    if (v.addon_price !== null) {
      nextAddon = parsePrice(addonText)
      if (nextAddon === null) {
        toast.error('Please enter a valid add-on price (0 to 1,000,000).')
        return
      }
    }
    const values: Partial<Pick<Variant, 'price' | 'addon_price'>> = {}
    if (nextPrice !== v.price) values.price = nextPrice
    if (v.addon_price !== null && nextAddon !== v.addon_price) values.addon_price = nextAddon
    if (!Object.keys(values).length) {
      setEditing(false)
      return
    }
    setSaving(true)
    const { error } = await rpc('admin_update_variant', { id: v.id, values })
    setSaving(false)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    cat.patch('variants', v.id, values)
    setEditing(false)
    toast.success('Price updated')
  }

  return (
    <li className={cn('flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1 text-xs', v.is_sold_out ? 'border-brand-red/30 bg-red-50' : 'border-sand-200 bg-cream/60')}>
      <span className="font-medium">{v.label}</span>
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <label className="inline-flex items-center gap-1">
            <span className="font-semibold text-navy/60">₱</span>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="1000000"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              aria-label={`${productName} ${v.label} price`}
              className="h-8 w-24 px-2 text-sm tabular-nums"
              autoFocus
              disabled={saving}
              onKeyDown={(e) => e.key === 'Escape' && cancel()}
            />
          </label>
          {v.addon_price !== null && (
            <label className="inline-flex items-center gap-1">
              <span className="font-semibold text-navy/60">+₱</span>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max="1000000"
                value={addonText}
                onChange={(e) => setAddonText(e.target.value)}
                aria-label={`${productName} ${v.label} add-on price`}
                className="h-8 w-20 px-2 text-sm tabular-nums"
                disabled={saving}
                onKeyDown={(e) => e.key === 'Escape' && cancel()}
              />
            </label>
          )}
          <Button type="submit" size="icon-sm" disabled={saving} aria-label="Save price" title="Save price">
            <Check />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" disabled={saving} onClick={cancel} aria-label="Cancel price edit" title="Cancel">
            <X />
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-semibold tabular-nums text-navy/80 transition hover:bg-white hover:text-brand-600"
          aria-label={`Edit ${productName} ${v.label} price`}
          title="Edit price"
        >
          <span>{peso(v.price)}</span>
          {v.addon_price !== null && <span className="text-navy/55">(+{peso(v.addon_price)})</span>}
          <Pencil className="size-3 text-navy/45" />
        </button>
      )}
      {showToggle && (
        <Switch
          size="sm"
          checked={!v.is_sold_out}
          aria-label={`${v.label} available`}
          title={v.is_sold_out ? 'Sold out. Tap to make available.' : 'Available. Tap to mark sold out.'}
          onCheckedChange={async (avail) => {
            cat.patch('variants', v.id, { is_sold_out: !avail })
            const { error } = await rpc('admin_update_variant', { id: v.id, values: { is_sold_out: !avail } })
            if (error) {
              cat.patch('variants', v.id, { is_sold_out: avail })
              toast.error(errorMessage(error))
            }
          }}
        />
      )}
    </li>
  )
}
