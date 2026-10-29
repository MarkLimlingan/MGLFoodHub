import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight, Banknote, Beef, CakeSlice, CalendarClock, ChevronRight, Clock, CookingPot, Fish, Flame, LayoutGrid, MapPin, Radio, Sandwich,
  Search, ShieldCheck, Soup, Store as StoreIcon, Truck, UtensilsCrossed, X, type LucideIcon,
} from 'lucide-react'
import { useCatalog, type Catalog } from '@/hooks/useCatalog'
import { useEarliestDelivery } from '@/hooks/useEarliestDelivery'
import { storeCardImage } from '@/lib/storeImages'
import type { Store } from '@/lib/types'
import { cn, formatHours, peso } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/controls'
import { EmptyState, ErrorBanner, SmartImage } from '@/components/common'
import { Logo } from '@/components/Logo'
import { InstallBanner } from '@/components/InstallApp'
import { Reveal } from '@/components/Reveal'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const CATEGORY_ICON: Record<string, LucideIcon> = {
  'puto-kakanin': CakeSlice,
  'pancit-bilao': Soup,
  restaurants: UtensilsCrossed,
  'wet-foods': Fish,
  carinderia: CookingPot,
  'merienda-street-food': Sandwich,
  diner: Beef,
  'sisig-crispy-favorites': Flame,
}

/** Fresh seafood: kept out of the store grid and shown in its own section (WetFoodsSection). */
const WET_FOODS = 'wet-foods'

export default function Home() {
  const cat = useCatalog()
  const storeCount = cat.stores.length || 14
  const [params, setParams] = useSearchParams()
  const [category, setCategory] = useState<string>('all')
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim())
  const searchRef = useRef<HTMLInputElement>(null)

  // Footer category links use ?cat=<slug>
  useEffect(() => {
    const slug = params.get('cat')
    if (!slug || !cat.categories.length) return
    const found = cat.categories.find((c) => c.slug === slug)
    if (found?.slug === WET_FOODS) setTimeout(() => document.getElementById('wet-foods')?.scrollIntoView({ behavior: 'smooth' }), 300)
    else if (found) setCategory(found.id)
    const next = new URLSearchParams(params)
    next.delete('cat')
    setParams(next, { replace: true })
  }, [params, cat.categories, setParams])

  const wetFoodsId = cat.categories.find((c) => c.slug === WET_FOODS)?.id
  const stores = useMemo(
    () => cat.stores.filter((s) => s.hub_category_id !== wetFoodsId && (category === 'all' || s.hub_category_id === category)),
    [cat.stores, category, wetFoodsId],
  )

  const results = useMemo(() => {
    if (q.length < 2) return []
    const terms = norm(q).split(/\s+/)
    return cat.products
      .map((p) => {
        const store = cat.storeById.get(p.store_id)!
        const section = cat.sectionById.get(p.section_id)
        const hay = norm(`${p.name} ${section?.name ?? ''} ${store?.name ?? ''} ${p.description ?? ''}`)
        return { p, store, section, hit: terms.every((t) => hay.includes(t)) }
      })
      .filter((r) => r.hit && r.store)
      .slice(0, 40)
  }, [q, cat])

  const goToStores = () => document.getElementById('stores')?.scrollIntoView({ behavior: 'smooth' })
  const pickCategory = (id: string) => {
    setCategory(id)
    setQuery('')
    requestAnimationFrame(goToStores)
  }
  const activeCategory = cat.categoryById.get(category)
  const earliest = useEarliestDelivery()

  return (
    <div className="mx-auto max-w-[110rem] px-3 sm:px-4 lg:px-6">
      <InstallBanner className="mt-4" />

      {/* ------------------------------------------------------------ Hero */}
      <section className="neu-raised relative mt-4 overflow-hidden rounded-[2rem] sm:mt-6">
        <div className="pointer-events-none absolute -right-24 top-0 hidden h-full w-[55%] rounded-l-[45%] bg-[#f6dcae] md:block" />
        <div className="relative grid grid-cols-1 items-center gap-8 px-4 py-10 sm:px-8 sm:py-14 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="animate-fade-up">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-navy/70">{storeCount} stores · One cart</p>
            <h1 className="mt-4 font-display text-[2.4rem] font-bold leading-[1.06] text-navy sm:text-[3rem] lg:text-[3.35rem]">
              Malabon's favorites,
              <br />
              delivered
              <br />
              <span className="text-brand-ink">on schedule.</span>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-navy/70">
              Puto, pancit bilao, crispy pata and lutong bahay ulam from the stores you love. Pick a date, pick a time, and we'll handle the rest.
            </p>

            {/* Search pill (reference: address input with round arrow button) */}
            <form
              className="mt-7 flex max-w-md items-center gap-2 rounded-full bg-white p-1.5 pl-5 shadow-lg shadow-navy/5 ring-1 ring-sand-200"
              onSubmit={(e) => {
                e.preventDefault()
                goToStores()
              }}
            >
              <Search className="size-5 shrink-0 text-brand-ink" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search puto, crispy pata, sisig…"
                className="h-11 min-w-0 flex-1 bg-transparent text-[16px] placeholder:text-navy/65 focus:outline-none"
                aria-label="Search all products"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="rounded-full p-1.5 text-navy/70 hover:bg-sand" aria-label="Clear search">
                  <X className="size-4" />
                </button>
              )}
              <button type="submit" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-navy transition hover:bg-[#f9a23a] active:scale-95" aria-label="Show results">
                <ArrowRight className="size-5" />
              </button>
            </form>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" className="w-full px-4 text-[15px] sm:w-auto sm:px-7 sm:text-base" onClick={goToStores}>
                Start your order <ArrowRight />
              </Button>
              <Button size="lg" variant="outline" className="w-full border-navy/15 bg-transparent sm:w-auto" asChild>
                <Link to="/my-orders">Track my order</Link>
              </Button>
            </div>

            <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-3 text-sm text-navy/80">
              {[
                { icon: Truck, t: 'One delivery fee' },
                { icon: Banknote, t: 'COD or Online Payment' },
                { icon: ShieldCheck, t: 'Private order tracking' },
              ].map(({ icon: Icon, t }) => (
                <li key={t} className="flex items-center gap-2">
                  <Icon className="size-5 text-navy" strokeWidth={1.6} /> {t}
                </li>
              ))}
            </ul>
          </div>

          <HeroCollage stores={cat.stores} />
        </div>
      </section>

      {/* ------------------------------------------------------------ Categories */}
      <Reveal className="mt-10" role="region" aria-label="Categories">
        <div className="-mx-3 flex gap-4 overflow-x-auto px-3 pb-2 scrollbar-none sm:-mx-4 lg:-mx-6 sm:gap-6 sm:px-4 lg:px-6 lg:justify-between">
          <CategoryTile icon={LayoutGrid} label="All stores" active={category === 'all'} onClick={() => pickCategory('all')} />
          {cat.categories.filter((c) => c.slug !== WET_FOODS).map((c) => (
            <CategoryTile
              key={c.id}
              icon={CATEGORY_ICON[c.slug] ?? StoreIcon}
              label={c.name}
              active={category === c.id}
              onClick={() => pickCategory(c.id)}
            />
          ))}
        </div>
      </Reveal>

      {/* ------------------------------------------------------------ Stores / search results */}
      <section id="stores" className="mt-12 scroll-mt-24">
        {cat.error && <ErrorBanner className="mb-6">{cat.error}</ErrorBanner>}

        {q.length >= 2 ? (
          <div>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <h2 className="font-display text-3xl font-bold sm:text-4xl">
                {results.length ? `Results for “${q}”` : `No results for “${q}”`}
              </h2>
              <button type="button" onClick={() => setQuery('')} className="flex items-center gap-1.5 text-sm font-medium text-navy hover:text-brand-ink">
                Clear search <X className="size-4" />
              </button>
            </div>
            {results.length === 0 ? (
              <EmptyState icon={<Search />} title="Wala kaming nahanap">Try another word, like “puto” or “pancit”.</EmptyState>
            ) : (
              <ul className="divide-y divide-sand overflow-hidden rounded-2xl border border-sand-200/70 bg-white">
                {results.map(({ p, store, section }) => {
                  const variants = cat.variantsByProduct.get(p.id) ?? []
                  const from = Math.min(...variants.map((v) => Number(v.price)))
                  return (
                    <li key={p.id}>
                      <Link to={`/store/${store.slug}?p=${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-cream">
                        <SmartImage src={storeCardImage(store)} alt="" className="hidden size-12 shrink-0 rounded-xl min-[360px]:block" />
                        <div className="min-w-0 flex-1">
                          <p className={cn('font-semibold', p.is_sold_out && 'text-navy/70 line-through')}>{p.name}</p>
                          <p className="truncate text-xs text-navy/70">
                            {store.name} · {section?.name}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {p.is_sold_out ? <span className="text-brand-red">Sold out</span> : `${variants.length > 1 ? 'from ' : ''}${peso(from)}`}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-navy/30" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : (
          <>
            <Reveal className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-3xl font-bold sm:text-4xl">{activeCategory ? activeCategory.name : 'Our Partner Stores'}</h2>
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-navy/70">
                  {stores.length} {stores.length === 1 ? 'store' : 'stores'}
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-navy">
                    <CalendarClock className="size-4 text-brand-ink" aria-hidden /> Earliest delivery {earliest ?? 'tomorrow'}
                  </span>
                </p>
              </div>
              {category !== 'all' && (
                <button type="button" onClick={() => setCategory('all')} className="flex items-center gap-1.5 text-sm font-medium text-navy hover:text-brand-ink">
                  View All <ArrowRight className="size-4" />
                </button>
              )}
            </Reveal>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 2xl:grid-cols-5">
              {cat.loading
                ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)
                : stores.map((s, i) => (
                    // Cards in the same row arrive a beat apart.
                    <Reveal key={s.id} delay={(i % 4) * 70} className="flex [&>a]:w-full">
                      <StoreCard store={s} category={cat.categoryById.get(s.hub_category_id)?.name} categorySlug={cat.categoryById.get(s.hub_category_id)?.slug} />
                    </Reveal>
                  ))}
            </div>
            {!cat.loading && stores.length === 0 && !cat.error && <EmptyState title="No stores in this category yet" />}
          </>
        )}
      </section>

      {/* ------------------------------------------------------------ Wet Foods (own section) */}
      {q.length < 2 && <WetFoodsSection />}

      {/* ------------------------------------------------------------ One cart banner */}
      <OneCartBanner onStart={goToStores} />

      {/* ------------------------------------------------------------ Feature strip */}
      <section className="neu-raised mt-12 grid grid-cols-1 gap-4 rounded-[2rem] p-5 sm:grid-cols-2 sm:p-7 lg:grid-cols-4">
        {[
          { icon: CalendarClock, t: 'Scheduled Delivery', d: 'Book for tomorrow or any day within 30 days.' },
          { icon: Banknote, t: 'COD or Online Payment', d: 'Pay cash to the rider (orders up to ₱2,000) or send via GCash, MariBank or GoTyme.' },
          { icon: Radio, t: 'Live Order Tracking', d: 'Your own private link shows every update.' },
          { icon: StoreIcon, t: 'One Delivery Fee', d: `Order from all ${storeCount} merchants in one go.` },
        ].map(({ icon: Icon, t, d }, i) => (
          <Reveal key={t} delay={i * 70} className="flex items-start gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sand text-brand-ink">
              <Icon className="size-5" strokeWidth={1.8} />
            </span>
            <div>
              <p className="font-heading text-sm font-semibold">{t}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-navy/70">{d}</p>
            </div>
          </Reveal>
        ))}
      </section>
    </div>
  )
}

/** "Order from every store, pay one delivery fee": centered, soft UI (neumorphism), one clear button. */
function OneCartBanner({ onStart }: { onStart: () => void }) {
  const cat = useCatalog()
  const earliest = useEarliestDelivery()
  const storeCount = cat.stores.length || 14
  const steps = [
    { title: 'Fill one cart', text: `Mix puto, pancit and crispy pata from any of the ${storeCount} stores.` },
    { title: 'Pick a day and time', text: `Choose your delivery slot. The earliest is ${earliest ?? 'tomorrow'}.` },
    { title: 'Pay your way', text: 'Cash on delivery or online payment.' },
  ]
  return (
    <Reveal className="mt-16" role="region" aria-labelledby="one-cart-title">
      <div className="neu-raised rounded-[2rem] px-5 py-12 text-center sm:px-10 sm:py-16">
        <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-navy/70">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden /> How it works
        </p>
        <h2 id="one-cart-title" className="mx-auto mt-4 max-w-3xl text-balance font-display text-3xl font-bold leading-[1.1] sm:text-[2.75rem]">
          Order from every store,<br /> <span className="inline-block text-brand-ink">pay one delivery fee.</span>
        </h2>
        {/* Steps: rows on phones, three columns joined by a thin line from sm up. */}
        <ol className="relative mx-auto mt-10 grid max-w-3xl gap-6 text-left before:absolute before:inset-x-[16.67%] before:top-5 before:hidden before:h-px before:bg-sand-200 sm:grid-cols-3 sm:gap-8 sm:text-center sm:before:block">
          {steps.map((s, i) => (
            <li key={s.title} className="relative flex items-start gap-4 sm:flex-col sm:items-center sm:gap-3">
              <span className="neu-raised-sm flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums text-brand-ink" aria-hidden>
                {i + 1}
              </span>
              <div>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-navy/70">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={onStart}
          className="neu-button mt-10 inline-flex min-h-13 items-center justify-center gap-2 rounded-full bg-brand px-8 text-base font-semibold text-navy transition-[background-color,box-shadow,transform] duration-150 hover:bg-[#f9a23a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy active:scale-[0.98]"
        >
          Start your order <ArrowRight className="size-4" />
        </button>
      </div>
    </Reveal>
  )
}

/** Shows one region of a (tall, text-heavy) menu photo — e.g. just the food shot. */
function CropImage({ src, size, position, className }: { src: string | null | undefined; size: string; position: string; className?: string }) {
  return (
    <div
      className={cn('bg-sand bg-no-repeat', className)}
      style={src ? { backgroundImage: `url('${src}')`, backgroundSize: size, backgroundPosition: position } : undefined}
    />
  )
}

/** Food photos from the stores' own menus, arranged like the reference hero image. */
function HeroCollage({ stores }: { stores: Store[] }) {
  const img = (slug: string) => stores.find((s) => s.slug === slug)?.cover_image_url
  return (
    <div className="relative mx-auto hidden aspect-square w-full max-w-lg md:block" aria-hidden>
      <div className="absolute inset-[6%] overflow-hidden rounded-full shadow-2xl shadow-navy/25 ring-8 ring-white">
        <CropImage src={img('rody-days')} size="215% auto" position="50% 0%" className="h-full w-full" />
      </div>
      <div className="absolute bottom-[2%] left-[-2%] w-[36%] -rotate-6 overflow-hidden rounded-2xl shadow-xl ring-4 ring-white">
        <CropImage src={img('hazels-special-puto')} size="230% auto" position="4% 64%" className="aspect-square w-full" />
      </div>
      <div className="absolute right-[6%] top-[2%] flex size-24 items-center justify-center rounded-full bg-white p-3 shadow-lg">
        <Logo className="h-16" />
      </div>
      <p className="absolute left-[4%] top-[2%] -rotate-12 font-display text-2xl italic leading-tight text-navy">
        Fresh
        <br />& Tasty
      </p>
    </div>
  )
}

function CategoryTile({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="group flex w-24 shrink-0 flex-col items-center text-center sm:w-28">
      <span
        className={cn(
          'flex size-20 items-center justify-center rounded-full transition-all sm:size-24',
          active ? 'bg-brand text-navy shadow-lg shadow-brand/30' : 'bg-sand text-brand-ink group-hover:bg-sand-200',
        )}
      >
        <Icon className="size-8 sm:size-9" strokeWidth={1.6} />
      </span>
      <span className="mt-3 text-sm font-semibold leading-tight text-navy">{label}</span>
      <span className={cn('mt-1 flex items-center gap-1 text-xs', active ? 'text-brand-ink' : 'text-navy/70 group-hover:text-brand-ink')}>
        Shop Now <ArrowRight className="size-3" />
      </span>
    </button>
  )
}

/** Lowest menu price at a store, or null. */
function storeFromPrice(cat: Catalog, storeId: string): number | null {
  let min = Infinity
  for (const p of cat.productsByStore.get(storeId) ?? []) {
    for (const v of cat.variantsByProduct.get(p.id) ?? []) min = Math.min(min, Number(v.price))
  }
  return Number.isFinite(min) ? min : null
}

/** For stores without a good picture: their name, set like a shop sign, with the category icon. */
function StoreNameTile({ name, icon: Icon, className }: { name: string; icon: LucideIcon; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-1.5 bg-[#fdf3e3] p-3 text-center sm:gap-2', className)} aria-hidden>
      <Icon className="size-5 text-brand-ink sm:size-7" strokeWidth={1.6} />
      <span className="line-clamp-3 font-display text-sm font-bold leading-tight text-navy sm:text-xl">{name}</span>
    </div>
  )
}

/** Wet Foods in its own section: one photo tile per category (Fresh Shrimp, Salmon, …), each opening that part of the store. */
function WetFoodsSection() {
  const cat = useCatalog()
  const category = cat.categories.find((c) => c.slug === WET_FOODS)
  const wetStores = category ? cat.stores.filter((s) => s.hub_category_id === category.id) : []
  const tiles = wetStores
    .flatMap((store) =>
      (cat.sectionsByStore.get(store.id) ?? []).map((section) => {
        const products = cat.productsBySection.get(section.id) ?? []
        const prices = products.flatMap((p) => (cat.variantsByProduct.get(p.id) ?? []).map((v) => Number(v.price)))
        return {
          store,
          section,
          count: products.length,
          from: prices.length ? Math.min(...prices) : null,
          image: products.find((p) => p.image_url)?.image_url ?? null,
        }
      }),
    )
    .filter((t) => t.count > 0)
  if (!category || !tiles.length) return null

  return (
    <section id="wet-foods" aria-labelledby="wet-foods-title" className="mt-16 scroll-mt-24">
      <Reveal className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-navy/70">
            <Fish className="size-4 text-brand-ink" aria-hidden /> Fresh seafood
          </p>
          <h2 id="wet-foods-title" className="mt-2 font-display text-3xl font-bold sm:text-4xl">
            {category.name}
          </h2>
          <p className="mt-1 text-sm text-navy/70">Fresh catch in the same cart, delivered on your schedule.</p>
        </div>
        {wetStores.length === 1 && (
          <Link to={`/store/${wetStores[0].slug}`} className="flex items-center gap-1.5 text-sm font-medium text-navy hover:text-brand-ink">
            See all {category.name.toLowerCase()} <ArrowRight className="size-4" />
          </Link>
        )}
      </Reveal>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-5">
        {tiles.map((t, i) => (
          <Reveal key={t.section.id} delay={(i % 5) * 70} className="flex [&>a]:w-full">
            <Link
              to={`/store/${t.store.slug}?s=${t.section.id}`}
              className="surface-card group flex flex-col overflow-hidden rounded-2xl transition-all hover:-translate-y-1 hover:shadow-lg hover:shadow-navy/10"
            >
              <div className="aspect-[4/3] overflow-hidden bg-[#fdf3e3]">
                {t.image ? (
                  <SmartImage src={t.image} alt="" className="h-full w-full transition-transform duration-500 group-hover:scale-105" />
                ) : (
                  <div className="flex h-full items-center justify-center text-brand-ink">
                    <Fish className="size-8" aria-hidden />
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
                <h3 className="font-heading text-base font-semibold leading-snug group-hover:text-brand-ink">{t.section.name}</h3>
                <p className="text-xs text-navy/70">
                  {t.count} {t.count === 1 ? 'item' : 'items'}
                  {t.from !== null && (
                    <>
                      {' · from '}
                      <span className="font-semibold text-navy tabular-nums">{peso(t.from)}</span>
                    </>
                  )}
                </p>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

function StoreCard({ store, category, categorySlug }: { store: Store; category?: string; categorySlug?: string }) {
  const cat = useCatalog()
  const img = storeCardImage(store)
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
          <StoreNameTile name={store.name} icon={CATEGORY_ICON[categorySlug ?? ''] ?? StoreIcon} className={cn('h-full w-full', !store.is_accepting_orders && 'grayscale')} />
        )}
        {!store.is_accepting_orders && (
          <span className="absolute inset-x-2 bottom-2 rounded-full bg-brand-red px-2 py-1 text-center text-[10px] font-bold leading-tight text-white shadow sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:px-2.5 sm:text-[11px]">Temporarily unavailable</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3.5 sm:gap-1.5 sm:p-4">
        <h3 className="font-heading text-base font-semibold leading-snug group-hover:text-brand-ink">{store.name}</h3>
        <p className="truncate text-xs text-navy/70" title={store.tagline ?? undefined}>
          {[category, store.tagline].filter(Boolean).join(' · ')}
        </p>
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
            Open store <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}
