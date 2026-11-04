import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleHelp } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage, rpc } from '@/lib/api'
import { PageShell } from '@/components/CustomerLayout'
import { ErrorBanner } from '@/components/common'
import { Skeleton } from '@/components/ui/controls'
import { LegalSection, MessageLink } from './Terms'

interface FaqItem {
  q: string
  a: string
}

/**
 * Frequently asked questions. The answers come from the API (get_faq), which builds them
 * from Admin → Settings, so they always match the cutoff, payments and delivery hours.
 * The same answers are in this page's FAQPage structured data for search engines and AI assistants.
 */
export default function Faq() {
  usePageTitle('Frequently Asked Questions')
  const [items, setItems] = useState<FaqItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void rpc<FaqItem[]>('get_faq').then(({ data, error }) => {
      if (error) setError(errorMessage(error))
      else setItems(data)
    })
  }, [])

  return (
    <PageShell title="Frequently Asked Questions" subtitle="Ordering, delivery, payment and tracking" icon={<CircleHelp />}>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="surface-card space-y-6 rounded-2xl p-5 text-sm leading-relaxed text-navy/80 sm:p-8 sm:text-[15px]">
        {items === null && !error
          ? Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-12 w-full" />
              </div>
            ))
          : items?.map((f) => (
              <LegalSection key={f.q} title={f.q}>
                <p>{f.a}</p>
              </LegalSection>
            ))}
        <p className="border-t border-sand pt-5">
          Still have a question? <MessageLink>Message us on Facebook</MessageLink> or see{' '}
          <Link to="/contact" className="font-semibold text-brand-ink underline underline-offset-2">
            Contact us
          </Link>
          .
        </p>
      </div>
    </PageShell>
  )
}
