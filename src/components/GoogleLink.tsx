import { useState, type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useGoogleLink, useGoogleRequired, type GoogleProfile } from '@/lib/google'
import { cn } from '@/lib/utils'
import { ErrorBanner, SmartImage } from './common'
import { Button } from './ui/button'

/** Google's own four-colour "G". */
export function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={cn('size-5', className)}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

/** "Continue with Google" in Google's own light style: white, grey border, four-colour G. */
export function GoogleButton({ onLink, disabled, className }: { onLink: () => Promise<void>; disabled?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true)
        await onLink()
        setBusy(false)
      }}
      className={cn(
        'flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-[#747775] bg-white px-5 font-semibold text-[#1F1F1F] transition hover:bg-[#F8F9FA] active:scale-[0.98] disabled:opacity-60',
        className,
      )}
    >
      <GoogleLogo />
      {busy ? 'Opening Google…' : 'Continue with Google'}
    </button>
  )
}

/** Shown instead of the checkout form until the customer links Google. */
export function GoogleGate({ onLink, error }: { onLink: () => Promise<void>; error: string | null }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-sand-200/70 sm:p-7">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#4285F4]/10 text-[#4285F4]">
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold">Sign in with your Gmail</h2>
          <p className="mt-1 text-sm text-navy/65">
            To keep out fake and scam orders, every order is verified with a Google account. We only see your name, Gmail address and profile photo.
            We never see your password.
          </p>
        </div>
      </div>
      {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}
      <GoogleButton onLink={onLink} className="mt-5" />
      <p className="mt-3 text-center text-xs text-navy/50">You'll come back here after Google. Your cart is saved.</p>
    </section>
  )
}

/** Compact "signed in as" row above the checkout form. */
export function GoogleLinked({ profile, onUnlink }: { profile: GoogleProfile; onUnlink: () => Promise<void> }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-sand-200/70">
      <SmartImage src={profile.picture} alt="" className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-navy/60">
          <GoogleLogo className="size-3.5" /> Verified with Google
        </p>
        <p className="truncate font-semibold">{profile.name}</p>
        {profile.email && <p className="truncate text-xs text-navy/55">{profile.email}</p>}
      </div>
      <button type="button" onClick={() => void onUnlink()} className="shrink-0 text-xs font-semibold text-navy/55 underline-offset-2 hover:text-navy hover:underline">
        Not you?
      </button>
    </div>
  )
}

/**
 * The cart's checkout button. When Google is required and not linked yet, it becomes
 * "Continue with Google", which signs the customer in and lands on checkout.
 */
export function CartCheckoutButton({ children, onCheckout, disabled }: { children: ReactNode; onCheckout: () => void; disabled?: boolean }) {
  const required = useGoogleRequired()
  const google = useGoogleLink()

  if (required && !google.profile) {
    return (
      <div className="space-y-1.5">
        <GoogleButton onLink={google.link} disabled={disabled || !google.ready} />
        <p className="text-center text-xs text-navy/55">Sign in with your Gmail to check out. This keeps out fake orders.</p>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      {required && google.profile && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-navy/60">
          <GoogleLogo className="size-3.5" /> Signed in as <span className="font-semibold text-navy">{google.profile.email ?? google.profile.name}</span>
        </p>
      )}
      <Button size="lg" className="w-full" disabled={disabled} onClick={onCheckout}>
        {children}
      </Button>
    </div>
  )
}
