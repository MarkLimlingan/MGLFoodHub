import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Accounts a customer can verify with at checkout. Facebook sign in was removed; old Facebook sessions are ignored. */
export type SignInProvider = 'google'
export const SIGN_IN_PROVIDERS: SignInProvider[] = ['google']
export const PROVIDER_NAME: Record<SignInProvider, string> = { google: 'Google' }
const isProvider = (p: unknown): p is SignInProvider => SIGN_IN_PROVIDERS.includes(p as SignInProvider)

export interface AccountProfile {
  provider: SignInProvider
  name: string
  email: string | null
  picture: string | null
}

/** Set before leaving for Google, so the guidelines popup doesn't reopen on the way back. */
export const SIGNIN_RETURN_KEY = 'mgl_google_return'
/** Which one the customer left for, so a failed return can name it. */
const SIGNIN_PROVIDER_KEY = 'mgl_signin_provider'

/** The account the customer verified with on this device, or null when they haven't. */
export function accountProfile(user: User | null): AccountProfile | null {
  if (!user) return null
  const app = user.app_metadata ?? {}
  const providers = (Array.isArray(app.providers) ? app.providers : [app.provider]).filter(isProvider)
  if (!providers.length) return null
  const provider = providers[0]
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

/** Reads (and clears) an error Google or Supabase sent back in the URL, e.g. when the customer cancels. */
function takeReturnError(): string | null {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const message = url.searchParams.get('error_description') ?? hash.get('error_description')
  if (!message && !url.searchParams.has('error') && !hash.has('error')) return null
  for (const k of ['error', 'error_code', 'error_description']) url.searchParams.delete(k)
  window.history.replaceState(window.history.state, '', url.pathname + url.search)
  return message ? message.replace(/\+/g, ' ') : 'Sign in did not finish linking your account.'
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

/** Why a return from Google didn't sign the customer in, in plain words. */
function unfinishedMessage(detail?: string): string {
  const name = PROVIDER_NAME[returnProvider]
  // No swap was even attempted: the secret saved before leaving isn't in this browser/address.
  if (!detail) {
    return `${name} sign in came back to a different page than where it started, so it couldn't finish. Please tap Continue with ${name} again from ${window.location.host}.`
  }
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

  /** Leaves the site for Google and comes back to checkout. */
  const link = async (provider: SignInProvider) => {
    setError(null)
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
        // Always show the account chooser, so a shared phone doesn't silently reuse someone else's Gmail.
        queryParams: { prompt: 'select_account' },
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
