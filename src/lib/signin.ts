import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './supabase'

/** Accounts a customer can verify with at checkout, in button order. */
export type SignInProvider = 'google' | 'facebook'
export const SIGN_IN_PROVIDERS: SignInProvider[] = ['google', 'facebook']
export const PROVIDER_NAME: Record<SignInProvider, string> = { google: 'Google', facebook: 'Facebook' }
const isProvider = (p: unknown): p is SignInProvider => SIGN_IN_PROVIDERS.includes(p as SignInProvider)

export interface AccountProfile {
  provider: SignInProvider
  name: string
  email: string | null
  picture: string | null
}

/** Set before leaving for Google or Facebook, so the guidelines popup doesn't reopen on the way back. */
export const SIGNIN_RETURN_KEY = 'mgl_google_return'
/** Which one the customer left for, so a failed return can name it. */
const SIGNIN_PROVIDER_KEY = 'mgl_signin_provider'

/** The account the customer verified with on this device, or null when they haven't. */
export function accountProfile(user: User | null): AccountProfile | null {
  if (!user) return null
  const app = user.app_metadata ?? {}
  const providers = (Array.isArray(app.providers) ? app.providers : [app.provider]).filter(isProvider)
  if (!providers.length) return null
  // Both linked (same email): show the one used most recently.
  const latest = (user.identities ?? [])
    .filter((i) => isProvider(i.provider))
    .sort((a, b) => (b.last_sign_in_at ?? '').localeCompare(a.last_sign_in_at ?? ''))[0]
  const provider = isProvider(latest?.provider) ? latest.provider : providers[0]
  const meta = user.user_metadata ?? {}
  return {
    provider,
    name: meta.full_name || meta.name || user.email || `${PROVIDER_NAME[provider]} user`,
    email: user.email || meta.email || null,
    picture: meta.avatar_url || meta.picture || null,
  }
}

/** Local testing only (npm run dev): show the sign in step without the admin switch. ?nogoogle hides it. */
export const devSignInPreview = () => import.meta.env.DEV && !new URLSearchParams(window.location.search).has('nogoogle')

let requiredCheck: Promise<boolean> | null = null

/** Whether the admin switched on "Require Google account at checkout" (checked once per page load). */
export function useSignInRequired(): boolean {
  const [required, setRequired] = useState(devSignInPreview)
  useEffect(() => {
    if (required) return
    requiredCheck ??= Promise.resolve(supabase.rpc('get_checkout_info')).then(
      ({ data }) => (data as { require_google_login?: boolean } | null)?.require_google_login === true,
      () => false,
    )
    void requiredCheck.then(setRequired)
  }, [required])
  return required
}

let facebookCheck: Promise<boolean> | null = null

/**
 * Whether Facebook is switched on in Supabase (Authentication → Sign In / Providers). Until it is,
 * Supabase answers a Facebook sign in with a bare error page, so the button explains instead.
 * If the check itself fails, let Supabase decide.
 */
function facebookEnabled(): Promise<boolean> {
  if (!supabaseConfigured) return Promise.resolve(false)
  // The public anon key goes in the address, not a header, so the browser sends one plain GET (no CORS preflight).
  const key = encodeURIComponent(import.meta.env.VITE_SUPABASE_ANON_KEY as string)
  facebookCheck ??= fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings?apikey=${key}`)
    .then((r) => (r.ok ? r.json() : null))
    .then(
      (s: { external?: Record<string, boolean> } | null) => s?.external?.facebook !== false,
      () => true,
    )
  return facebookCheck
}

/** Turns what Supabase or the provider sent back into plain words. */
function friendlyReturnError(message: string): string {
  // Facebook accounts made with a phone number have no email for Supabase to save.
  if (/error getting user email/i.test(message)) {
    return "Your Facebook account doesn't have an email address, so it can't be used to verify orders. Please continue with Google, or add an email to your Facebook account first."
  }
  return message
}

/** Reads (and clears) an error Google, Facebook or Supabase sent back in the URL, e.g. when the customer cancels. */
function takeReturnError(): string | null {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const message = url.searchParams.get('error_description') ?? hash.get('error_description')
  if (!message && !url.searchParams.has('error') && !hash.has('error')) return null
  for (const k of ['error', 'error_code', 'error_description']) url.searchParams.delete(k)
  window.history.replaceState(window.history.state, '', url.pathname + url.search)
  return message ? friendlyReturnError(message.replace(/\+/g, ' ')) : 'Sign in did not finish linking your account.'
}

// Read once when the site loads, so whichever part of the page asks first doesn't swallow it for the rest.
const returnError = typeof window === 'undefined' ? null : takeReturnError()

// The provider comes back with ?code=… (PKCE). supabase-js swaps it for a session on load, using a secret it
// saved in this browser before leaving. Remember the code was here, so a failed swap isn't silent.
const returnedWithCode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('code')

const returnProvider: SignInProvider = (() => {
  try {
    const p = sessionStorage.getItem(SIGNIN_PROVIDER_KEY)
    return isProvider(p) ? p : 'google'
  } catch {
    return 'google'
  }
})()

/** Why a return from Google or Facebook didn't sign the customer in, in plain words. */
function unfinishedMessage(detail?: string): string {
  const name = PROVIDER_NAME[returnProvider]
  // No swap was even attempted: the secret saved before leaving isn't in this browser/address.
  if (!detail) {
    return `${name} sign in came back to a different page than where it started, so it couldn't finish. Please tap Continue with ${name} again from ${window.location.host}.`
  }
  const friendly = friendlyReturnError(detail)
  if (friendly !== detail) return friendly
  return `${name} sign in didn't finish (${detail}). Please tap Continue with ${name} again.`
}

export function useAccountLink() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(returnError)

  useEffect(() => {
    let alive = true
    // initialize() settles after supabase-js has handled any ?code=… from the provider, and returns its error if the swap failed.
    void supabase.auth.initialize().then(async ({ error: initError }) => {
      const { data } = await supabase.auth.getSession()
      if (!alive) return
      const u = data.session?.user ?? null
      setUser(u)
      setReady(true)
      if (initError) setError(unfinishedMessage(initError.message))
      else if (returnedWithCode && !accountProfile(u)) setError(unfinishedMessage())
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setReady(true)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  /** Leaves the site for Google or Facebook and comes back to checkout. */
  const link = async (provider: SignInProvider) => {
    setError(null)
    if (provider === 'facebook' && !(await facebookEnabled())) {
      setError("Facebook sign in isn't ready yet. Please continue with Google for now.")
      return
    }
    try {
      sessionStorage.setItem(SIGNIN_RETURN_KEY, '1')
      sessionStorage.setItem(SIGNIN_PROVIDER_KEY, provider)
    } catch {
      /* private mode: the guidelines popup just shows again */
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/checkout${window.location.search}`,
        // Google: always show the account chooser, so a shared phone doesn't silently reuse someone else's Gmail.
        queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
      },
    })
    if (error) setError(error.message)
  }

  /** Signs out on this device only. */
  const unlink = async () => {
    await supabase.auth.signOut({ scope: 'local' })
  }

  return { ready, profile: accountProfile(user), error, link, unlink }
}
