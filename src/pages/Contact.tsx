import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Fish, Phone, ShieldCheck } from 'lucide-react'
import { FISH_PORT_SLUG, useCatalog } from '@/hooks/useCatalog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { telHref, useOwnerPhone } from '@/lib/contact'
import { formatPhone } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/controls'
import { OWNER_MESSAGE_URL } from '@/components/common'
import { MessengerLogo } from '@/components/FishRequest'
import { Reveal } from '@/components/Reveal'

/** Contact Us: the owner's Facebook page and phone (Admin → Settings; hidden when empty), plus order help. */
export default function Contact() {
  usePageTitle('Contact Us')
  const cat = useCatalog()
  const phone = useOwnerPhone()
  const wetFoods = cat.stores.find((s) => s.slug === FISH_PORT_SLUG)

  return (
    <div className="mx-auto max-w-4xl px-3 py-8 sm:px-4 sm:py-12">
      <Reveal>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-navy/70">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden /> Contact us
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold leading-tight sm:text-5xl">We're here to help</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-navy/75">
          Questions about an order, a merchant, payments or delivery? Message us on Facebook{phone ? ' or give us a call' : ''}.
        </p>
      </Reveal>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <ContactCard
          icon={<MessengerLogo className="size-5" />}
          iconClass="bg-[#0084ff]/10 text-[#0866ff]"
          title="Message us on Facebook"
          text="The fastest way to reach our team about orders, payments and special requests."
          action={
            <Button asChild className="w-full">
              <a href={OWNER_MESSAGE_URL} target="_blank" rel="noopener noreferrer">
                <MessengerLogo className="size-4" /> Message us
              </a>
            </Button>
          }
        />
        {phone === null ? (
          <Skeleton className="h-48 rounded-2xl bg-white" />
        ) : (
          phone && (
            <ContactCard
              icon={<Phone className="size-5" aria-hidden />}
              iconClass="bg-brand-50 text-brand-ink"
              title="Call us"
              text={
                <>
                  Business contact number
                  <a href={telHref(phone)} className="mt-0.5 block font-heading text-lg font-bold tabular-nums text-navy hover:text-brand-ink">
                    {formatPhone(phone)}
                  </a>
                </>
              }
              action={
                <Button asChild variant="navy" className="w-full">
                  <a href={telHref(phone)}>
                    <Phone /> Call us
                  </a>
                </Button>
              }
            />
          )
        )}
      </div>

      <section aria-labelledby="contact-help" className="mt-12">
        <h2 id="contact-help" className="font-display text-2xl font-bold sm:text-3xl">Quick help</h2>
        <ul className="mt-5 divide-y divide-sand overflow-hidden rounded-2xl bg-white ring-1 ring-sand-200/70">
          <HelpRow icon={<ClipboardList />} to="/find-order" title="Check an order" text="Find your order with its order number and the phone number you used." />
          <HelpRow icon={<ClipboardList />} to="/my-orders" title="Orders on this device" text="See every order you placed from this phone or computer." />
          {wetFoods && (
            <HelpRow icon={<Fish />} to={`/store/${wetFoods.slug}`} title="Looking for a specific fish?" text={`Open ${wetFoods.name} and tap Request a Fish to ask the owner.`} />
          )}
          <HelpRow icon={<ShieldCheck />} to="/privacy#delete-data" title="Your data" text="How we use your information, and how to ask us to delete it." />
        </ul>
      </section>
    </div>
  )
}

function ContactCard({ icon, iconClass, title, text, action }: { icon: ReactNode; iconClass: string; title: string; text: ReactNode; action: ReactNode }) {
  return (
    <div className="surface-card flex flex-col rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${iconClass}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg font-bold">{title}</h2>
          <div className="mt-0.5 text-sm text-navy/70">{text}</div>
        </div>
      </div>
      <div className="mt-auto pt-4">{action}</div>
    </div>
  )
}

function HelpRow({ icon, to, title, text }: { icon: ReactNode; to: string; title: string; text: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-cream sm:px-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sand text-brand-ink [&_svg]:size-5" aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block text-sm text-navy/70">{text}</span>
        </span>
      </Link>
    </li>
  )
}
