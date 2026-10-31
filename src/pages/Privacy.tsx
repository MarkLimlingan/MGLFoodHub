import { useEffect } from 'react'
import { ShieldCheck } from 'lucide-react'
import { PageShell } from '@/components/CustomerLayout'
import { OWNER_MESSAGE_URL } from '@/components/common'
import { LegalSection, MessageLink } from './Terms'

// Linked from the Google sign in settings (OAuth consent screen) and the Facebook app settings as the privacy policy.
// #delete-data is the data deletion instructions page for both.
export default function Privacy() {
  useEffect(() => {
    document.title = 'Privacy Policy · MGL Food Hub'
  }, [])
  return (
    <PageShell title="Privacy Policy" subtitle="Last updated October 14, 2026" icon={<ShieldCheck />}>
      <div className="surface-card space-y-6 rounded-2xl p-5 text-sm leading-relaxed text-navy/80 sm:p-8 sm:text-[15px]">
        <p>
          MGL Food Hub runs this website for scheduled food delivery from our partner stores in Malabon. This page explains what information we
          collect, why we collect it, and how you can have it deleted.
        </p>

        <LegalSection title="What we collect">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>When you order: your name, mobile number, email, delivery address, landmark, notes, delivery date and time, and the items you ordered.</li>
            <li>For GCash, MariBank or GoTyme payments: the reference number and the payment screenshot you upload.</li>
            <li>
              If you sign in with Google: your name, Gmail address and profile photo from your Google account. We never see your Google
              password and we can't read your emails.
            </li>
            <li>On your phone: your cart and the tracking links of your orders are saved in your browser only.</li>
          </ul>
        </LegalSection>

        <LegalSection title="Why we use it">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>To prepare, confirm and deliver your order.</li>
            <li>To verify your payment.</li>
            <li>To contact you about your order by text, call or email.</li>
            <li>To stop fake, scam and duplicate orders.</li>
          </ul>
        </LegalSection>

        <LegalSection title="Who can see it">
          <p>
            Our team can see your orders. The partner stores and the delivery rider receive only what they need to prepare and deliver your order. We
            don't sell your information.
          </p>
        </LegalSection>

        <LegalSection title="Where it is kept">
          <p>
            Your information is stored in our database hosted by Supabase. Payment screenshots are private and only our team can view them. We keep
            your information for as long as we need it to handle your orders and keep our business records.
          </p>
        </LegalSection>

        <LegalSection title="Your rights">
          <p>
            Under the Data Privacy Act of 2012 (Republic Act No. 10173), you can ask to see, correct or delete the personal information we keep about
            you.
          </p>
        </LegalSection>

        <LegalSection id="delete-data" title="Delete your data">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              <MessageLink>Message us on Facebook</MessageLink> and say you want your data deleted.
            </li>
            <li>Include the name and mobile number you used on your orders.</li>
            <li>We delete your personal information and the Google account linked to your orders, then message you when it's done.</li>
          </ol>
          <p className="mt-3">
            We may keep records the law requires us to keep. You can also remove MGL Food Hub from your Google account. In your Google Account, open
            Security, then Your connections to third party apps and services, and remove MGL Food Hub.
          </p>
        </LegalSection>

        <LegalSection title="Contact us">
          <p>
            Questions about your privacy? <MessageLink>Message us on Facebook</MessageLink>.
          </p>
          <p className="mt-1 break-all text-xs text-navy/70">{OWNER_MESSAGE_URL}</p>
        </LegalSection>
      </div>
    </PageShell>
  )
}
