import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowRight, Banknote, CalendarClock, ChevronRight, Fish, LayoutGrid, Radio, Search, ShieldCheck, Store as StoreIcon, Truck, X,
} from 'lucide-react'
import { useCatalog } from '@/hooks/useCatalog'
import { useEarliestDelivery } from '@/hooks/useEarliestDelivery'
import { cn, peso } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/controls'
import { EmptyState, ErrorBanner, SmartImage } from '@/components/common'
import { InstallBanner } from '@/components/InstallApp'
import { HeroVideo } from '@/components/HeroVideo'
import { Reveal } from '@/components/Reveal'
import { categoriesWithStores, categoryIcon, StoreCard, storePicture } from '@/components/Marketplace'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Fresh seafood keeps its own photo tile section (WetFoodsSection). */
const WET_FOODS = 'wet-foods'

export default function Home() {
  const cat = useCatalog()
  const merchantCount = cat.stores.length || 14
  const [params] = useSearchParams()
  const { hash } = useLocation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim())

  // Old links: "/#stores" (all stores) now lives on Explore Merchants.
  useEffect(() => {
    if (hash === '#stores') navigate('/merchants', { replace: true })
  }, [hash, navigate])

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

  // Old links: "/?cat=<slug>" (footer, shared links) now open that category on Explore Merchants.
  const oldCategory = params.get('cat')
  if (oldCategory) return <Navigate to={`/merchants?cat=${encodeURIComponent(oldCategory)}`} replace />

  const showResults = () => document.getElementById('search-results')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div className="mx-auto max-w-[110rem] px-3 sm:px-4 lg:px-6">
      <InstallBanner className="mt-4" />

      {/* ------------------------------------------------------------ Hero */}
      <section className="relative isolate mt-4 overflow-hidden rounded-[2rem] bg-navy text-white shadow-xl shadow-navy/15 sm:mt-6">
        <HeroVideo />
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(13_43_78/0.62)_0%,rgb(13_43_78/0.72)_60%,rgb(13_43_78/0.82)_100%)] lg:bg-[linear-gradient(90deg,rgb(13_43_78/0.88)_0%,rgb(13_43_78/0.7)_38%,rgb(13_43_78/0.25)_72%,rgb(13_43_78/0.08)_100%)]"
          aria-hidden
        />
        <div className="relative flex items-center px-4 py-12 sm:px-8 sm:py-16 md:min-h-[600px] lg:px-12">
          <div className="max-w-xl animate-fade-up [text-shadow:0_1px_2px_rgb(13_43_78/0.35)]">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/80">{merchantCount} merchants · One cart</p>
            <h1 className="mt-4 font-display text-[1.95rem] font-bold leading-[1.08] text-white min-[400px]:text-[2.15rem] sm:text-[3rem] lg:text-[3.35rem]">
              Everything You Love,
              <br />
              All in One <span className="text-brand">Food Hub.</span>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/85">
              Discover restaurants, fresh seafood, local food merchants, and everyday favorites in one convenient marketplace.
            </p>

            <form
              className="mt-7 flex max-w-md items-center gap-2 rounded-full bg-white p-1.5 pl-5 text-navy shadow-lg shadow-navy/20 ring-1 ring-sand-200 [text-shadow:none]"
              onSubmit={(e) => {
                e.preventDefault()
                showResults()
              }}
            >
              <Search className="size-5 shrink-0 text-brand-ink" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search dishes or merchants"
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

            <div className="mt-6 flex flex-wrap gap-3 [text-shadow:none]">
              <Button size="lg" className="w-full px-4 text-[15px] focus-visible:ring-offset-navy sm:w-auto sm:px-7 sm:text-base" asChild>
                <Link to="/merchants">
                  Explore Merchants <ArrowRight />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full border-white/45 bg-transparent text-white hover:border-white hover:bg-white/10 hover:text-white focus-visible:ring-offset-navy sm:w-auto"
                asChild
              >
                <Link to="/categories">Browse Categories</Link>
              </Button>
            </div>

            <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-3 text-sm text-white/85">
              {[
                { icon: Truck, t: 'One delivery fee' },
                { icon: Banknote, t: 'COD or Online Payment' },
                { icon: ShieldCheck, t: 'Private order tracking' },
              ].map(({ icon: Icon, t }) => (
                <li key={t} className="flex items-center gap-2">
                  <Icon className="size-5 text-brand" strokeWidth={1.6} /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {cat.error && <ErrorBanner className="mt-6">{cat.error}</ErrorBanner>}

      {q.length >= 2 ? (
        /* ------------------------------------------------------------ Search results */
        <section id="search-results" className="mt-12 scroll-mt-24">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">{results.length ? `Results for “${q}”` : `No results for “${q}”`}</h2>
            <button type="button" onClick={() => setQuery('')} className="flex items-center gap-1.5 text-sm font-medium text-navy hover:text-brand-ink">
              Clear search <X className="size-4" />
            </button>
          </div>
          {results.length === 0 ? (
            <EmptyState icon={<Search />} title="Wala kaming nahanap">Try another word, like “puto”, “bangus” or “pancit”.</EmptyState>
          ) : (
            <ul className="divide-y divide-sand overflow-hidden rounded-2xl border border-sand-200/70 bg-white">
              {results.map(({ p, store, section }) => {
                const variants = cat.variantsByProduct.get(p.id) ?? []
                const from = Math.min(...variants.map((v) => Number(v.price)))
                return (
                  <li key={p.id}>
                    <Link to={`/store/${store.slug}?p=${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-cream">
                      <SmartImage src={p.image_url ?? storePicture(cat, store)} alt="" className="hidden size-12 shrink-0 rounded-xl min-[360px]:block" />
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
        </section>
      ) : (
        <>
          <CategoriesRow />
          <FeaturedMerchants />
          <WetFoodsSection />
          <OneCartBanner />
        </>
      )}

      {/* ------------------------------------------------------------ Feature strip */}
      <section className="neu-raised mt-12 grid grid-cols-1 gap-4 rounded-[2rem] p-5 sm:grid-cols-2 sm:p-7 lg:grid-cols-4">
        {[
          { icon: CalendarClock, t: 'Scheduled Delivery', d: 'Book for tomorrow or any day within 30 days.' },
          { icon: Banknote, t: 'COD or Online Payment', d: 'Pay cash to the rider (orders up to ₱2,000) or send via GCash, MariBank or GoTyme.' },
          { icon: Radio, t: 'Live Order Tracking', d: 'Your own private link shows every update.' },
          { icon: StoreIcon, t: 'One Delivery Fee', d: `Order from all ${merchantCount} merchants in one go.` },
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

/** Heading row used by every homepage section: eyebrow, title, optional "see all" link. */
function SectionHead({ id, eyebrow, title, subtitle, link }: { id: string; eyebrow?: string; title: string; subtitle?: string; link?: { to: string; label: string } }) {
  return (
    <Reveal className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && (
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-navy/70">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden /> {eyebrow}
          </p>
        )}
        <h2 id={id} className="mt-2 font-display text-3xl font-bold sm:text-4xl">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-navy/70">{subtitle}</p>}
      </div>
      {link && (
        <Link to={link.to} className="inline-flex min-h-6 items-center gap-1.5 text-sm font-medium text-navy hover:text-brand-ink">
          {link.label} <ArrowRight className="size-4" />
        </Link>
      )}
    </Reveal>
  )
}

/** Every category that has merchants, each opening Explore Merchants filtered to it. */
function CategoriesRow() {
  const cat = useCatalog()
  const groups = categoriesWithStores(cat)
  return (
    <section aria-labelledby="home-categories" className="mt-12">
      <SectionHead id="home-categories" eyebrow="Explore" title="Food categories" link={{ to: '/categories', label: 'All categories' }} />
      <Reveal>
        <div className="-mx-3 flex gap-4 overflow-x-auto px-3 pb-2 scrollbar-none sm:-mx-4 sm:gap-6 sm:px-4 lg:-mx-6 lg:justify-between lg:px-6">
          <CategoryTile to="/merchants" icon={LayoutGrid} label="All merchants" count={cat.stores.length} />
          {cat.loading
            ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 w-24 shrink-0 rounded-2xl sm:w-28" />)
            : groups.map(({ category, stores }) => (
                <CategoryTile key={category.id} to={`/merchants?cat=${category.slug}`} icon={categoryIcon(category.slug)} label={category.name} count={stores.length} />
              ))}
        </div>
      </Reveal>
    </section>
  )
}

function CategoryTile({ to, icon: Icon, label, count }: { to: string; icon: typeof LayoutGrid; label: string; count: number }) {
  return (
    <Link to={to} className="group flex w-24 shrink-0 flex-col items-center text-center sm:w-28">
      <span className="flex size-20 items-center justify-center rounded-full bg-sand text-brand-ink transition-all group-hover:bg-brand group-hover:text-navy group-hover:shadow-lg group-hover:shadow-brand/30 sm:size-24">
        <Icon className="size-8 sm:size-9" strokeWidth={1.6} />
      </span>
      <span className="mt-3 text-sm font-semibold leading-tight text-navy">{label}</span>
      <span className="mt-1 text-xs text-navy/70 group-hover:text-brand-ink">
        {count} {count === 1 ? 'merchant' : 'merchants'}
      </span>
    </Link>
  )
}

/** Merchants with a photo first, in the store order set in the data. */
function FeaturedMerchants() {
  const cat = useCatalog()
  const earliest = useEarliestDelivery()
  const featured = useMemo(() => {
    const open = cat.stores.filter((s) => s.is_accepting_orders)
    return [...open.filter((s) => storePicture(cat, s)), ...open.filter((s) => !storePicture(cat, s))].slice(0, 8)
  }, [cat])
  return (
    <section aria-labelledby="home-merchants" className="mt-16">
      <SectionHead
        id="home-merchants"
        eyebrow="Featured merchants"
        title="Shop your favorite merchants"
        subtitle={`Earliest delivery ${earliest ?? 'tomorrow'}. Mix items from any of them in one cart.`}
        link={{ to: '/merchants', label: `See all ${cat.stores.length || ''} merchants`.replace('  ', ' ') }}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
        {cat.loading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)
          : featured.map((s, i) => (
              <Reveal key={s.id} delay={(i % 4) * 70} className="flex [&>a]:w-full">
                <StoreCard store={s} />
              </Reveal>
            ))}
      </div>
    </section>
  )
}

/** "Order from every store, pay one delivery fee": centered, soft UI (neumorphism), one clear button. */
function OneCartBanner() {
  const cat = useCatalog()
  const earliest = useEarliestDelivery()
  const merchantCount = cat.stores.length || 14
  const steps = [
    { title: 'Fill one cart', text: `Mix food from any of the ${merchantCount} merchants: kakanin, ulam, crispy favorites or fresh seafood.` },
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
          Order from every merchant,<br /> <span className="inline-block text-brand-ink">pay one delivery fee.</span>
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
        <Link
          to="/merchants"
          className="neu-button mt-10 inline-flex min-h-13 items-center justify-center gap-2 rounded-full bg-brand px-8 text-base font-semibold text-navy transition-[background-color,box-shadow,transform] duration-150 hover:bg-[#f9a23a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy active:scale-[0.98]"
        >
          Start your order <ArrowRight className="size-4" />
        </Link>
      </div>
    </Reveal>
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
          <h2 id="wet-foods-title" className="font-display text-3xl font-bold sm:text-4xl">
            Fresh Option Malabon Fishport
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
