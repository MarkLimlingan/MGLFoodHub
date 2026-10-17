import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ScrollText } from 'lucide-react'
import { PageShell } from '@/components/CustomerLayout'
import { OWNER_MESSAGE_URL } from '@/components/common'

export function LegalSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="mb-2 font-heading text-base font-bold text-navy sm:text-lg">{title}</h2>
      {children}
    </section>
  )
}

export function MessageLink({ children }: { children: ReactNode }) {
  return (
    <a href={OWNER_MESSAGE_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-ink underline underline-offset-2">
      {children}
    </a>
  )
}

// Linked from the Google sign in settings (OAuth consent screen) as the terms of service.
export default function Terms() {
  useEffect(() => {
    document.title = 'Terms of Service · MGL Food Hub'
  }, [])
  return (
    <PageShell title="Terms of Service" subtitle="Last updated October 14, 2026" icon={<ScrollText />}>
      <div className="surface-card space-y-6 rounded-2xl p-5 text-sm leading-relaxed text-navy/80 sm:p-8 sm:text-[15px]">
        <p>These terms apply when you order through the MGL Food Hub website. By placing an order, you agree to them.</p>

        <LegalSection title="Orders">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>All orders are scheduled. Same day delivery is not available, and the earliest delivery date is tomorrow.</li>
            <li>Our team confirms every order by text or call before it is prepared.</li>
            <li>We may cancel an order we can't confirm, or one that looks fake or fraudulent.</li>
          </ul>
        </LegalSection>

        <LegalSection title="Prices and payment">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Menu prices are VAT inclusive and are set by each merchant. They may change, but you pay the price shown when you placed your order.</li>
            <li>You can pay by Cash on Delivery (for orders up to ₱2,000 only) or online via GCash, MariBank or GoTyme. Online payments are verified before your order is confirmed.</li>
          </ul>
        </LegalSection>

        <LegalSection title="Delivery fee and food quality">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>One delivery fee covers your whole order, even with items from several merchants. Our team confirms the fee.</li>
            <li>Higher delivery fees may apply for long distance deliveries.</li>
            <li>For long distance deliveries, the quality of some food items may not be the same as in store.</li>
          </ul>
        </LegalSection>

        <LegalSection title="Cancellations">
          <p>
            You can request a cancellation from your order tracking page while the order is still being processed. Once it is confirmed,{' '}
            <MessageLink>message us on Facebook</MessageLink>, including about payments for cancelled orders.
          </p>
        </LegalSection>

        <LegalSection title="Google verification">
          <p>
            We may ask you to sign in with your Google (Gmail) account before you order. We use it only to confirm you are a real customer and to stop fake and scam
            orders. See our{' '}
            <Link to="/privacy" className="font-semibold text-brand-ink underline underline-offset-2">
              Privacy Policy
            </Link>{' '}
            for what we receive.
          </p>
        </LegalSection>

        <LegalSection title="Fake and scam orders">
          <p>We may refuse future orders from phone numbers or Google accounts linked to fake, scam or unpaid orders.</p>
        </LegalSection>

        <LegalSection title="Changes to these terms">
          <p>We may update these terms. The date at the top shows when they last changed.</p>
        </LegalSection>

        <LegalSection title="Contact us">
          <p>
            Questions? <MessageLink>Message us on Facebook</MessageLink>.
          </p>
        </LegalSection>
      </div>
    </PageShell>
  )
}
