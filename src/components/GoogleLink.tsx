import { useState, type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import {
  PROVIDER_NAME, SIGN_IN_PROVIDERS, useAccountLink, useSignInRequired, type AccountProfile, type SignInProvider,
} from '@/lib/signin'
import { installPlatform } from '@/lib/install'
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

/** Facebook's round "f": blue on light backgrounds, white on the blue button. */
export function FacebookLogo({ className, color = '#1877F2' }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('size-5', className)}>
      <path
        fill={color}
        d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.971H15.83c-1.49 0-1.955.93-1.955 1.886v2.265h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"
      />
    </svg>
  )
}

export function ProviderLogo({ provider, className }: { provider: SignInProvider; className?: string }) {
  return provider === 'facebook' ? <FacebookLogo className={className} /> : <GoogleLogo className={className} />
}

/** "Continue with Google" in Google's light style, or "Continue with Facebook" in Facebook blue. */
function ProviderButton({ provider, onLink, disabled }: { provider: SignInProvider; onLink: () => Promise<void>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const name = PROVIDER_NAME[provider]
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
        'flex min-h-12 w-full items-center justify-center gap-3 rounded-full px-5 font-semibold transition active:scale-[0.98] disabled:opacity-60',
        provider === 'facebook'
          ? 'bg-[#1877F2] text-white hover:bg-[#166FE5]'
          : 'border border-[#747775] bg-white text-[#1F1F1F] hover:bg-[#F8F9FA]',
      )}
    >
      {provider === 'facebook' ? <FacebookLogo color="#ffffff" /> : <GoogleLogo />}
      {busy ? `Opening ${name}…` : `Continue with ${name}`}
    </button>
  )
}

/** Google and Facebook buttons. Google blocks sign in inside Facebook's and Messenger's built-in browser, so Facebook goes first there. */
export function SignInButtons({ onLink, disabled }: { onLink: (p: SignInProvider) => Promise<void>; disabled?: boolean }) {
  const inApp = installPlatform() === 'in-app'
  const ordered = inApp ? [...SIGN_IN_PROVIDERS].reverse() : SIGN_IN_PROVIDERS
  return (
    <div className="space-y-2.5">
      {ordered.map((p) => (
        <ProviderButton key={p} provider={p} onLink={() => onLink(p)} disabled={disabled} />
      ))}
      {inApp && (
        <p className="text-center text-xs text-navy/70">
          Google sign in doesn't work inside the Facebook or Messenger app. Use Facebook, or open this page in Chrome or Safari.
        </p>
      )}
    </div>
  )
}

/** Shown instead of the checkout form until the customer signs in. */
export function SignInGate({ onLink, error }: { onLink: (p: SignInProvider) => Promise<void>; error: string | null }) {
  return (
    <section className="surface-card rounded-2xl p-5 sm:p-7">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-ink">
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold">Sign in to place your order</h2>
          <p className="mt-1 text-sm text-navy/70">
            To keep out fake and scam orders, every order is verified with a Google or Facebook account. We only see your name, email address
            and profile photo. We never see your password.
          </p>
        </div>
      </div>
      {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}
      <div className="mt-5">
        <SignInButtons onLink={onLink} />
      </div>
      <p className="mt-3 text-center text-xs text-navy/70">You'll come back here after signing in. Your cart is saved.</p>
    </section>
  )
}

/** Compact "signed in as" row above the checkout form. */
export function SignedInAs({ profile, onUnlink }: { profile: AccountProfile; onUnlink: () => Promise<void> }) {
  return (
    <div className="surface-card flex items-center gap-3 rounded-2xl px-4 py-3">
      <SmartImage src={profile.picture} alt="" className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-navy/70">
          <ProviderLogo provider={profile.provider} className="size-3.5" /> Verified with {PROVIDER_NAME[profile.provider]}
        </p>
        <p className="truncate font-semibold">{profile.name}</p>
        {profile.email && <p className="truncate text-xs text-navy/70">{profile.email}</p>}
      </div>
      <button type="button" onClick={() => void onUnlink()} className="shrink-0 text-xs font-semibold text-navy/70 underline-offset-2 hover:text-navy hover:underline">
        Not you?
      </button>
    </div>
  )
}

/**
 * The cart's checkout button. When sign in is required and the customer hasn't yet, it becomes the
 * Google (and Facebook) buttons, which sign them in and land on checkout.
 */
export function CartCheckoutButton({ children, onCheckout, disabled }: { children: ReactNode; onCheckout: () => void; disabled?: boolean }) {
  const required = useSignInRequired()
  const account = useAccountLink()

  if (required && !account.profile) {
    return (
      <div className="space-y-1.5">
        {account.error && <ErrorBanner className="mb-2.5 text-left">{account.error}</ErrorBanner>}
        <SignInButtons onLink={account.link} disabled={disabled || !account.ready} />
        <p className="text-center text-xs text-navy/70">Sign in with Google or Facebook to check out. This keeps out fake orders.</p>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      {required && account.profile && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-navy/70">
          <ProviderLogo provider={account.profile.provider} className="size-3.5" /> Signed in as{' '}
          <span className="font-semibold text-navy">{account.profile.email ?? account.profile.name}</span>
        </p>
      )}
      <Button size="lg" className="w-full" disabled={disabled} onClick={onCheckout}>
        {children}
      </Button>
    </div>
  )
}
