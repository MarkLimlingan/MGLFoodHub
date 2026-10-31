import { Suspense, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ArrowRight, Banknote, ClipboardList, Home, Info, ShoppingBag, Store as StoreIcon, type LucideIcon } from 'lucide-react'
import { useCartView, useCatalog } from '@/hooks/useCatalog'
import { cn, peso } from '@/lib/utils'
import { ONLINE_METHODS, PAYMENT_LOGO, PAYMENT_METHOD_LABEL } from '@/lib/orderStatus'
import { Logo } from './Logo'
import { CartSheet, useCartUI } from './Cart'
import { OrderingGuidelines, useGuidelines } from './OrderingGuidelines'
import { DELIVERY_DISCLAIMER, ScheduledNotice } from './common'
import { InstallDialog, InstallLink, InstallNavButton } from './InstallApp'
import { Skeleton } from './ui/controls'

/** Same rule everywhere so the bars never hide content. */
function useFloatingCartVisible() {
  const { count } = useCartView()
  const { pathname } = useLocation()
  return count > 0 && !['/checkout', '/cart'].includes(pathname) && !/^\/(track|order-placed)/.test(pathname)
}

function CartButton() {
  const { count } = useCartView()
  const setOpen = useCartUI((s) => s.setOpen)
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="relative flex size-11 items-center justify-center rounded-full text-navy transition hover:bg-sand active:scale-95"
      aria-label={`Open cart, ${count} items`}
    >
      <ShoppingBag className="size-[22px]" />
      {count > 0 && (
        <span
          key={count}
          className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold leading-5 text-navy ring-2 ring-white animate-pop"
        >
          {count}
        </span>
      )}
    </button>
  )
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  cn(
    'relative py-2 text-sm font-medium transition-colors hover:text-navy after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-brand after:transition-transform',
    isActive ? 'text-navy after:scale-x-100' : 'text-navy/70 after:scale-x-0 hover:after:scale-x-100',
  )

function Navbar() {
  const { pathname } = useLocation()
  const openGuidelines = useGuidelines((s) => s.setOpen)
  return (
    <header className="sticky top-0 z-40 border-b border-sand-200/70 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[110rem] items-center justify-center gap-3 px-3 sm:px-4 lg:px-6 md:h-[68px] md:justify-between">
        <Link to="/" className="shrink-0" aria-label="MGL Food Hub home">
          <Logo className="h-11 md:h-12" />
        </Link>

        {/* Desktop / tablet: text links (on phones these live in the bottom bar) */}
        <nav className="hidden items-center gap-6 md:flex lg:gap-8" aria-label="Main">
          <NavLink to="/" end className={() => navLink({ isActive: pathname === '/' })}>
            Home
          </NavLink>
          <Link to="/#stores" className={navLink({ isActive: pathname.startsWith('/store/') })}>
            Stores
          </Link>
          <NavLink to="/my-orders" className={navLink}>
            My Orders
          </NavLink>
          <NavLink to="/find-order" className={navLink}>
            Find my order
          </NavLink>
          <button type="button" onClick={() => openGuidelines(true)} className={navLink({ isActive: false })} aria-label="Ordering guidelines">
            Guidelines
          </button>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <InstallNavButton />
          <CartButton />
        </div>
      </div>
    </header>
  )
}

/** Phones: four labeled tabs. The cart lives in the "View cart" bar above (it shows once something is in it). */
function MobileNav() {
  const { pathname, hash } = useLocation()
  const cartOpen = useCartUI((s) => s.open)
  const openGuidelines = useGuidelines((s) => s.setOpen)
  const guidelinesOpen = useGuidelines((s) => s.open)
  const overlay = cartOpen || guidelinesOpen

  const tabs: { to?: string; label: string; icon: LucideIcon; active: boolean; onClick?: () => void }[] = [
    { to: '/', label: 'Home', icon: Home, active: !overlay && pathname === '/' && hash !== '#stores' },
    { to: '/#stores', label: 'Stores', icon: StoreIcon, active: !overlay && (pathname.startsWith('/store/') || (pathname === '/' && hash === '#stores')) },
    { to: '/my-orders', label: 'Orders', icon: ClipboardList, active: !overlay && /^\/(my-orders|track|find-order|order-placed)/.test(pathname) },
    { label: 'Help', icon: Info, active: guidelinesOpen, onClick: () => openGuidelines(true) },
  ]
  const tab = (active: boolean) =>
    cn(
      'flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold leading-none transition-colors active:scale-95',
      active ? 'text-navy' : 'text-navy/70 hover:text-navy',
    )
  const pill = (active: boolean) =>
    cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', active ? 'bg-brand text-navy shadow-sm shadow-brand/30' : '')

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-sand-200/70 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_-12px_rgba(13,43,78,0.25)] backdrop-blur-md md:hidden"
      aria-label="Main"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-4">
        {tabs.map(({ to, label, icon: Icon, active, onClick }) => {
          const inner = (
            <>
              <span className={pill(active)}>
                <Icon className="size-[21px]" strokeWidth={active ? 2.2 : 1.9} />
              </span>
              {label}
            </>
          )
          return (
            <li key={label}>
              {to ? (
                <Link to={to} className={tab(active)} aria-current={active ? 'page' : undefined}>
                  {inner}
                </Link>
              ) : (
                <button type="button" onClick={onClick} className={tab(active)}>
                  {inner}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Light cream footer: navy text, orange accents (dots, underlines, divider). */
function Footer() {
  const { categories, stores } = useCatalog()
  const openGuidelines = useGuidelines((s) => s.setOpen)
  const heading = 'mb-3 flex items-center gap-2 font-heading text-sm font-semibold text-navy'
  const dot = <span className="size-1.5 rounded-full bg-brand" aria-hidden />
  // navy/75 keeps links readable on sand (5.8:1); hover adds an orange underline.
  const item =
    'block w-fit py-1 text-sm text-navy/75 underline-offset-4 transition-colors hover:text-navy hover:underline hover:decoration-brand hover:decoration-2'
  return (
    <footer className="mx-auto mt-16 w-full max-w-[110rem] px-3 pb-4 sm:px-4 lg:px-6 sm:pb-6">
      <div className="neu-raised relative overflow-hidden rounded-[2rem] text-navy">
        <div className="relative grid grid-cols-2 gap-x-6 gap-y-8 px-4 py-10 sm:px-8 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div className="col-span-2 space-y-4 lg:col-span-1">
            <Logo className="h-16" />
            <p className="font-display text-2xl italic leading-none text-navy">Good food, on schedule.</p>
            <p className="max-w-xs text-sm text-navy/75">{stores.length || 14} Malabon favorites in one cart, with scheduled delivery straight to your door.</p>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy/70">We accept</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="surface-card inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 font-medium text-navy">
                  <Banknote className="size-3.5 text-emerald-600" /> Cash on Delivery
                </span>
                {ONLINE_METHODS.map((m) => (
                  <span key={m} className="surface-card inline-flex h-[30px] items-center rounded-full px-3" title={PAYMENT_METHOD_LABEL[m]}>
                    <img src={PAYMENT_LOGO[m]} alt={PAYMENT_METHOD_LABEL[m]} className="h-4 w-auto max-w-16 object-contain" />
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div>
            <p className={heading}>{dot}Quick Links</p>
            <Link to="/" className={item}>Home</Link>
            <Link to="/#stores" className={item}>All stores</Link>
            <Link to="/cart" className={item}>Cart</Link>
            <Link to="/checkout" className={item}>Checkout</Link>
          </div>
          <div>
            <p className={heading}>{dot}Your Orders</p>
            <Link to="/my-orders" className={item}>My orders on this device</Link>
            <Link to="/find-order" className={item}>Find my order</Link>
            <button type="button" onClick={() => openGuidelines(true)} className={cn(item, 'text-left')}>
              Ordering guidelines
            </button>
            <InstallLink className={cn(item, 'text-left')} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className={heading}>{dot}Categories</p>
            <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-1">
              {categories.map((c) => (
                <Link key={c.id} to={`/?cat=${c.slug}#stores`} className={item}>
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
        <div className="relative px-4 pb-6 sm:px-8">
          <div className="h-px bg-gradient-to-r from-brand/70 via-brand/30 to-transparent" aria-hidden />
          <p className="mt-5 max-w-3xl text-xs leading-relaxed text-navy/70">{DELIVERY_DISCLAIMER}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-navy/75">
            <span>© {new Date().getFullYear()} MGL Food Hub. All rights reserved.</span>
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              <Link to="/privacy" className="inline-flex min-h-6 items-center underline-offset-4 hover:text-navy hover:underline hover:decoration-brand">Privacy Policy</Link>
              <Link to="/terms" className="inline-flex min-h-6 items-center underline-offset-4 hover:text-navy hover:underline hover:decoration-brand">Terms of Service</Link>
              <button type="button" onClick={() => openGuidelines(true)} className="inline-flex min-h-6 items-center underline-offset-4 hover:text-navy hover:underline hover:decoration-brand">
                Ordering guidelines
              </button>
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}

/** "View cart" bar on phones, floating just above the bottom navigation. */
function FloatingCartBar() {
  const { count, subtotalCents } = useCartView()
  const setOpen = useCartUI((s) => s.setOpen)
  if (!useFloatingCartVisible()) return null
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-3 pb-2.5 md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto flex w-full max-w-md items-center justify-between rounded-full bg-navy px-5 py-3 font-semibold text-white shadow-xl shadow-navy/25 animate-fade-up active:scale-[0.98]"
      >
        <span className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-full bg-brand text-sm text-navy">{count}</span>
          View cart
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          {peso(subtotalCents / 100)} <ArrowRight className="size-4" />
        </span>
      </button>
    </div>
  )
}

export function CustomerLayout() {
  const { pathname, hash } = useLocation()
  const cartBar = useFloatingCartVisible()
  // Tags customer pages so headings use Inter (index.css); the admin keeps its own fonts.
  useLayoutEffect(() => {
    document.documentElement.classList.add('mgl-customer')
    return () => document.documentElement.classList.remove('mgl-customer')
  }, [])
  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
    } else {
      window.scrollTo({ top: 0 })
    }
  }, [pathname, hash])

  return (
    <div
      className={cn(
        'flex min-h-dvh flex-col md:pb-0',
        // keep the footer clear of the bottom bar (and the cart bar when it shows)
        cartBar ? 'pb-[calc(8.5rem+env(safe-area-inset-bottom))]' : 'pb-[calc(4rem+env(safe-area-inset-bottom))]',
      )}
    >
      <ScheduledNotice />
      <Navbar />
      <main className="flex-1">
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      <FloatingCartBar />
      <MobileNav />
      <CartSheet />
      <OrderingGuidelines />
      <InstallDialog />
    </div>
  )
}

export function PageShell({ title, subtitle, children, icon }: { title: string; subtitle?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-3 py-8 sm:px-4 sm:py-12">
      <div className="mb-7 flex items-start gap-3 animate-fade-up">
        {icon && <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sand text-brand-ink [&_svg]:size-5">{icon}</div>}
        <div>
          <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-navy/70">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

function PageLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-3 py-10 sm:px-4">
      <Skeleton className="h-9 w-1/2" />
      <Skeleton className="h-40" />
      <Skeleton className="h-64" />
    </div>
  )
}
