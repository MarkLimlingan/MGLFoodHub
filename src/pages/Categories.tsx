import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useCatalog } from '@/hooks/useCatalog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { Skeleton } from '@/components/ui/controls'
import { ErrorBanner, SmartImage } from '@/components/common'
import { Reveal } from '@/components/Reveal'
import { categoriesWithStores, categoryIcon, storePicture } from '@/components/Marketplace'

/** Food categories that have merchants; each opens Explore Merchants filtered to it. */
export default function Categories() {
  usePageTitle('Food Categories')
  const cat = useCatalog()
  const groups = categoriesWithStores(cat)

  return (
    <div className="mx-auto max-w-[110rem] px-3 py-8 sm:px-4 sm:py-12 lg:px-6">
      <Reveal>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-navy/70">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden /> Browse
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold leading-tight sm:text-5xl">Food Categories</h1>
        <p className="mt-2 max-w-2xl text-sm text-navy/70">
          From kakanin and pancit bilao to crispy favorites and fresh seafood. Pick a category to see its merchants, then fill one cart from any of them.
        </p>
      </Reveal>

      {cat.error && <ErrorBanner className="mt-6">{cat.error}</ErrorBanner>}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 2xl:grid-cols-4">
        {cat.loading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-2xl" />)
          : groups.map(({ category, stores }, i) => {
              const Icon = categoryIcon(category.slug)
              const picture = stores.map((s) => storePicture(cat, s)).find(Boolean) ?? null
              const products = stores.reduce((n, s) => n + (cat.productsByStore.get(s.id)?.length ?? 0), 0)
              const names = stores.slice(0, 3).map((s) => s.name)
              return (
                <Reveal key={category.id} delay={(i % 3) * 70} className="flex [&>a]:w-full">
                  <Link
                    to={`/merchants?cat=${category.slug}`}
                    className="surface-card group flex flex-col overflow-hidden rounded-2xl transition-all hover:-translate-y-1 hover:shadow-lg hover:shadow-navy/10"
                  >
                    <div className="relative aspect-[16/9] overflow-hidden bg-[#fdf3e3]">
                      {picture ? (
                        <SmartImage src={picture} alt="" className="h-full w-full transition-transform duration-500 group-hover:scale-105" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-brand-ink" aria-hidden>
                          <Icon className="size-12" strokeWidth={1.4} />
                        </div>
                      )}
                      <span className="absolute left-3 top-3 flex size-10 items-center justify-center rounded-full bg-white text-brand-ink shadow-md" aria-hidden>
                        <Icon className="size-5" strokeWidth={1.8} />
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-4 sm:p-5">
                      <h2 className="font-heading text-lg font-semibold leading-snug group-hover:text-brand-ink">{category.name}</h2>
                      <p className="text-xs text-navy/70">
                        {stores.length} {stores.length === 1 ? 'merchant' : 'merchants'} · {products} {products === 1 ? 'item' : 'items'}
                      </p>
                      <p className="text-sm text-navy/80">
                        {names.join(', ')}
                        {stores.length > names.length && ` and ${stores.length - names.length} more`}
                      </p>
                      <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-semibold text-brand-ink">
                        See merchants <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </Link>
                </Reveal>
              )
            })}
      </div>
    </div>
  )
}
