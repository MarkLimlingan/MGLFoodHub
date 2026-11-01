import { Link } from 'react-router-dom'
import { ArrowRight, Banknote, CalendarClock, Check, Radio, Store as StoreIcon, Truck } from 'lucide-react'
import { useCatalog } from '@/hooks/useCatalog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { COD_MAX_LABEL, ONLINE_METHODS, PAYMENT_METHOD_LABEL } from '@/lib/orderStatus'
import { Button } from '@/components/ui/button'
import { Reveal } from '@/components/Reveal'
import { useOrderingGuidelines } from '@/components/OrderingGuidelines'
import { categoriesWithStores, categoryIcon } from '@/components/Marketplace'

/** About Us: only what the site already knows (merchants, categories, the admin's ordering guidelines, payments). */
export default function About() {
  usePageTitle('About Us')
  const cat = useCatalog()
  const guidelines = useOrderingGuidelines()
  const groups = categoriesWithStores(cat)
  const merchantCount = cat.stores.length || 14
  const online = ONLINE_METHODS.map((m) => PAYMENT_METHOD_LABEL[m])

  return (
    <div className="mx-auto max-w-5xl px-3 py-8 sm:px-4 sm:py-12">
      <Reveal>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-navy/70">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden /> About us
        </p>
        <h1 className="mt-2 max-w-3xl font-display text-4xl font-bold leading-tight sm:text-5xl">
          One cart for <span className="text-brand-ink">{merchantCount} Malabon merchants.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-navy/75">
          MGL Food Hub brings local food businesses together in one place: kakanin makers, pancit bilao specialists, carinderias, diners,
          crispy favorites and fresh seafood. Order from as many merchants as you like, schedule one delivery, and pay one delivery fee.
        </p>
      </Reveal>

      {/* What you'll find */}
      <section aria-labelledby="about-merchants" className="mt-12">
        <h2 id="about-merchants" className="font-display text-2xl font-bold sm:text-3xl">What you'll find</h2>
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map(({ category, stores }) => {
            const Icon = categoryIcon(category.slug)
            return (
              <li key={category.id}>
                <Link to={`/merchants?cat=${category.slug}`} className="surface-card group flex h-full items-start gap-3 rounded-2xl p-4 transition hover:shadow-md">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sand text-brand-ink" aria-hidden>
                    <Icon className="size-5" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-heading font-semibold group-hover:text-brand-ink">{category.name}</span>
                    <span className="mt-0.5 block text-sm text-navy/70">{stores.map((s) => s.name).join(', ')}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      {/* How it works */}
      <section aria-labelledby="about-how" className="mt-12 grid gap-4 sm:grid-cols-2">
        <h2 id="about-how" className="font-display text-2xl font-bold sm:col-span-2 sm:text-3xl">How ordering works</h2>
        {[
          { icon: StoreIcon, t: 'Shop many merchants at once', d: 'Add food from any merchant to the same cart. Delivery hours are matched for you.' },
          { icon: CalendarClock, t: 'Scheduled delivery', d: 'Pick a delivery date and a one hour time slot. Same day delivery is not available.' },
          {
            icon: Banknote,
            t: 'Pay your way',
            d: `Cash on Delivery for orders up to ${COD_MAX_LABEL}, or online via ${online.slice(0, -1).join(', ')} or ${online.at(-1)}.`,
          },
          { icon: Radio, t: 'Track every step', d: 'Your private tracking link shows each update, from confirmation to delivery.' },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="surface-card flex items-start gap-3 rounded-2xl p-4 sm:p-5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-ink" aria-hidden>
              <Icon className="size-5" strokeWidth={1.8} />
            </span>
            <div>
              <h3 className="font-heading font-semibold">{t}</h3>
              <p className="mt-0.5 text-sm leading-relaxed text-navy/70">{d}</p>
            </div>
          </div>
        ))}
      </section>

      {/* Guidelines (Admin → Settings) */}
      <section aria-labelledby="about-guidelines" className="neu-raised mt-12 rounded-[2rem] p-5 sm:p-8">
        <h2 id="about-guidelines" className="flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl">
          <Truck className="size-6 text-brand-ink" aria-hidden /> Ordering guidelines
        </h2>
        <ul className="mt-5 space-y-3">
          {guidelines.map((g) => (
            <li key={g} className="flex items-start gap-3 text-sm leading-relaxed text-navy/80">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /> {g}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button size="lg" asChild>
          <Link to="/merchants">
            Explore Merchants <ArrowRight />
          </Link>
        </Button>
        <Button size="lg" variant="outline" className="border-navy/15 bg-transparent" asChild>
          <Link to="/contact">Contact Us</Link>
        </Button>
      </div>
    </div>
  )
}
