import { Link } from 'react-router-dom'
import {
  ArrowRight, Beef, CakeSlice, Clock, CookingPot, Fish, Flame, MapPin, Sandwich, Soup, Store as StoreIcon, UtensilsCrossed, type LucideIcon,
} from 'lucide-react'
import { listOrder, useCatalog, type Catalog } from '@/hooks/useCatalog'
import { storeCardImage } from '@/lib/storeImages'
import type { HubCategory, Store } from '@/lib/types'
import { cn, formatHours, peso } from '@/lib/utils'
import { SmartImage } from './common'

export const CATEGORY_ICON: Record<string, LucideIcon> = {
  'puto-kakanin': CakeSlice,
  'pancit-bilao': Soup,
  restaurants: UtensilsCrossed,
  'wet-foods': Fish,
  carinderia: CookingPot,
  'merienda-street-food': Sandwich,
  diner: Beef,
  'sisig-crispy-favorites': Flame,
}

export const categoryIcon = (slug?: string): LucideIcon => CATEGORY_ICON[slug ?? ''] ?? StoreIcon

/** Lowest menu price at a store, or null. */
export function storeFromPrice(cat: Catalog, storeId: string): number | null {
  let min = Infinity
  for (const p of cat.productsByStore.get(storeId) ?? []) {
    for (const v of cat.variantsByProduct.get(p.id) ?? []) min = Math.min(min, Number(v.price))
  }
  return Number.isFinite(min) ? min : null
}

/** A store's card picture: its card image, else one of its own product photos (e.g. Wet Foods), else null. */
export function storePicture(cat: Catalog, store: Store): string | null {
  return storeCardImage(store) ?? (cat.productsByStore.get(store.id) ?? []).find((p) => p.image_url)?.image_url ?? null
}

/** Stores per category, in category order, without empty categories. */
export function categoriesWithStores(cat: Catalog): { category: HubCategory; stores: Store[] }[] {
  return [...cat.categories]
    .sort(listOrder)
    .map((category) => ({ category, stores: cat.stores.filter((s) => s.hub_category_id === category.id) }))
    .filter((c) => c.stores.length > 0)
}

/** For stores without a good picture: their name, set like a shop sign, with the category icon. */
export function StoreNameTile({ name, icon: Icon, className }: { name: string; icon: LucideIcon; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-1.5 bg-[#fdf3e3] p-3 text-center sm:gap-2', className)} aria-hidden>
      <Icon className="size-5 text-brand-ink sm:size-7" strokeWidth={1.6} />
      <span className="line-clamp-3 font-display text-sm font-bold leading-tight text-navy sm:text-xl">{name}</span>
    </div>
  )
}

export function StoreCard({ store }: { store: Store }) {
  const cat = useCatalog()
  const category = cat.categoryById.get(store.hub_category_id)
  const img = storePicture(cat, store)
  const from = storeFromPrice(cat, store.id)
  return (
    <Link
      to={`/store/${store.slug}`}
      className="surface-card group flex flex-row overflow-hidden rounded-2xl sm:flex-col transition-all hover:-translate-y-1 hover:shadow-lg hover:shadow-navy/10"
    >
      <div className="relative w-28 shrink-0 overflow-hidden sm:aspect-[4/3] sm:w-auto">
        {img ? (
          <SmartImage
            src={img}
            alt=""
            fallbackLabel={store.name}
            className={cn('h-full w-full transition-transform duration-500 group-hover:scale-105', !store.is_accepting_orders && 'grayscale')}
          />
        ) : (
          <StoreNameTile name={store.name} icon={categoryIcon(category?.slug)} className={cn('h-full w-full', !store.is_accepting_orders && 'grayscale')} />
        )}
        {!store.is_accepting_orders && (
          <span className="absolute inset-x-2 bottom-2 rounded-full bg-brand-red px-2 py-1 text-center text-[10px] font-bold leading-tight text-white shadow sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:px-2.5 sm:text-[11px]">Temporarily unavailable</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3.5 sm:gap-1.5 sm:p-4">
        {category && <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-ink">{category.name}</p>}
        <h3 className="font-heading text-base font-semibold leading-snug group-hover:text-brand-ink">{store.name}</h3>
        {store.tagline && (
          <p className="line-clamp-2 text-xs text-navy/70" title={store.tagline}>
            {store.tagline}
          </p>
        )}
        <p className="mt-1 flex items-center gap-1.5 text-xs text-navy/70">
          <Clock className="size-3.5 shrink-0" /> {formatHours(store.open_time, store.close_time)}
        </p>
        {store.address && (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-navy/70">
            <MapPin className="size-3.5 shrink-0" /> <span className="truncate">{store.address}</span>
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          {from !== null ? (
            <span className="text-xs text-navy/70">
              from <span className="text-sm font-bold tabular-nums text-navy">{peso(from)}</span>
            </span>
          ) : (
            <span />
          )}
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink">
            Browse store <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}
