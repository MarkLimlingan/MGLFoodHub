import { useDeferredValue, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarClock, Search, Store as StoreIcon, X } from 'lucide-react'
import { useCatalog } from '@/hooks/useCatalog'
import { useEarliestDelivery } from '@/hooks/useEarliestDelivery'
import { usePageTitle } from '@/hooks/usePageTitle'
import { Skeleton, Chip } from '@/components/ui/controls'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorBanner } from '@/components/common'
import { Reveal } from '@/components/Reveal'
import { categoriesWithStores, categoryIcon, StoreCard } from '@/components/Marketplace'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Explore Merchants: every merchant, searchable by name and filtered by category (?cat=<slug>). */
export default function Merchants() {
  usePageTitle('Explore Merchants')
  const cat = useCatalog()
  const earliest = useEarliestDelivery()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const q = useDeferredValue(norm(query.trim()))
  const groups = categoriesWithStores(cat)
  const slug = params.get('cat') ?? ''
  const active = groups.find((g) => g.category.slug === slug)?.category

  const setCategory = (next: string) => {
    const p = new URLSearchParams(params)
    if (next) p.set('cat', next)
    else p.delete('cat')
    setParams(p, { replace: true })
  }

  const stores = useMemo(
    () =>
      cat.stores.filter((s) => {
        if (active && s.hub_category_id !== active.id) return false
        if (!q) return true
        const category = cat.categoryById.get(s.hub_category_id)?.name ?? ''
        return norm(`${s.name} ${s.tagline ?? ''} ${category}`).includes(q)
      }),
    [cat.stores, cat.categoryById, active, q],
  )

  return (
    <div className="mx-auto max-w-[110rem] px-3 py-8 sm:px-4 sm:py-12 lg:px-6">
      <Reveal className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-navy/70">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden /> Marketplace
          </p>
          <h1 className="mt-2 font-display text-4xl font-bold leading-tight sm:text-5xl">{active ? active.name : 'Explore Merchants'}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-navy/70">
            {stores.length} {stores.length === 1 ? 'merchant' : 'merchants'}
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-navy">
              <CalendarClock className="size-4 text-brand-ink" aria-hidden /> Earliest delivery {earliest ?? 'tomorrow'}
            </span>
          </p>
        </div>
        <label className="relative w-full sm:w-80">
          <span className="sr-only">Search merchants</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-brand-ink" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search merchants"
            className="h-12 w-full rounded-full bg-white pl-11 pr-11 text-[16px] shadow-sm ring-1 ring-sand-200 placeholder:text-navy/60 focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-navy/70 hover:bg-sand" aria-label="Clear search">
              <X className="size-4" />
            </button>
          )}
        </label>
      </Reveal>

      {/* Category filter */}
      <div className="-mx-3 mt-6 flex gap-2 overflow-x-auto px-3 pb-2 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Filter by category">
        <Chip selected={!active} onClick={() => setCategory('')} className="shrink-0">
          All
          <span className="text-xs opacity-70">{cat.stores.length}</span>
        </Chip>
        {groups.map(({ category, stores: list }) => {
          const Icon = categoryIcon(category.slug)
          return (
            <Chip key={category.id} selected={active?.id === category.id} onClick={() => setCategory(category.slug)} className="shrink-0">
              <Icon className="size-4" aria-hidden /> {category.name}
              <span className="text-xs opacity-70">{list.length}</span>
            </Chip>
          )
        })}
      </div>

      {cat.error && <ErrorBanner className="mt-6">{cat.error}</ErrorBanner>}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 2xl:grid-cols-5">
        {cat.loading
          ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)
          : stores.map((s, i) => (
              <Reveal key={s.id} delay={(i % 4) * 70} className="flex [&>a]:w-full">
                <StoreCard store={s} />
              </Reveal>
            ))}
      </div>

      {!cat.loading && stores.length === 0 && !cat.error && (
        <EmptyState
          icon={<StoreIcon />}
          title={q ? 'No merchants match your search' : 'No merchants here yet'}
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQuery('')
                setCategory('')
              }}
            >
              Show all merchants
            </Button>
          }
        >
          {q ? 'Try another name, or search for a dish on the home page.' : undefined}
        </EmptyState>
      )}

      <p className="mt-10 text-center text-sm text-navy/70">
        Looking for a specific dish?{' '}
        <Link to="/" className="font-semibold text-brand-ink underline-offset-4 hover:underline">
          Search all products on the home page
        </Link>
      </p>
    </div>
  )
}
