import { useEffect, useState, useSyncExternalStore } from 'react'
import { customerToken, errorMessage, rpc, setCustomerToken } from './api'
import { randomId } from './utils'

/** Accounts a customer can verify with at checkout. */
export type SignInProvider = 'google'
export const SIGN_IN_PROVIDERS: SignInProvider[] = ['google']
export const PROVIDER_NAME: Record<SignInProvider, string> = { google: 'Google' }

export interface AccountProfile {
  provider: SignInProvider
  name: string
  email: string | null
  picture: string | null
}

/** Set before leaving for Google, so the guidelines popup doesn't reopen on the way back. */
export const SIGNIN_RETURN_KEY = 'mgl_google_return'
/** What we sent to Google (state, nonce) and the checkout address to come back to. */
const SIGNIN_STATE_KEY = 'mgl_google_state'

/** Local testing only (npm run dev): show the sign in step without the admin switch. ?nogoogle hides it. */
export const devSignInPreview = () => import.meta.env.DEV && !new URLSearchParams(window.location.search).has('nogoogle')

interface CheckoutBasics {
  require_google_login?: boolean
  google_client_id?: string
}
let basics: Promise<CheckoutBasics | null> | null = null
function loadBasics(): Promise<CheckoutBasics | null> {
  basics ??= rpc<CheckoutBasics>('get_checkout_info').then(({ data, error }) => {
    if (error) basics = null // try again next time
    return data
  })
  return basics
}

/** Whether the admin switched on "Require Google account at checkout" (checked once per page load). */
export function useSignInRequired(): boolean {
  const [required, setRequired] = useState(devSignInPreview)
  useEffect(() => {
    if (required) return
    void loadBasics().then((d) => setRequired(d?.require_google_login === true))
  }, [required])
  return required
}

// ---------------------------------------------------------------------
// One shared sign in state for every part of the page (cart, checkout)
// ---------------------------------------------------------------------
interface State {
  ready: boolean
  profile: AccountProfile | null
  error: string | null
}
let state: State = { ready: false, profile: null, error: null }
const listeners = new Set<() => void>()
function set(next: Partial<State>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

type GoogleProfile = { name: string | null; email: string | null; picture: string | null }
const toProfile = (p: GoogleProfile): AccountProfile => ({
  provider: 'google',
  name: p.name || p.email || 'Google user',
  email: p.email,
  picture: p.picture,
})

function takeSaved(): { state: string; nonce: string; search: string } | null {
  try {
    const raw = sessionStorage.getItem(SIGNIN_STATE_KEY)
    sessionStorage.removeItem(SIGNIN_STATE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Runs once when the site loads: finishes a return from Google (the ID token
 * comes back in the address after #), or checks the saved sign in.
 */
async function start() {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  if (hash.has('id_token') || hash.has('error')) {
    const saved = takeSaved()
    // Take the token out of the address straight away, and put back the checkout address it left from.
    window.history.replaceState(window.history.state, '', window.location.pathname + (saved?.search ?? window.location.search))
    if (!saved || hash.get('state') !== saved.state) {
      return set({ ready: true, error: `Google sign in came back to a different page than where it started, so it couldn't finish. Please tap Continue with Google again from ${window.location.host}.` })
    }
    if (hash.has('error')) {
      const cancelled = hash.get('error') === 'access_denied'
      return set({ ready: true, error: cancelled ? 'Google sign in was cancelled.' : 'Google sign in did not finish. Please tap Continue with Google again.' })
    }
    const { data, error } = await rpc<GoogleProfile & { token: string }>('google_sign_in', { credential: hash.get('id_token'), nonce: saved.nonce })
    if (error) return set({ ready: true, error: errorMessage(error) })
    setCustomerToken(data.token)
    return set({ ready: true, profile: toProfile(data) })
  }
  if (!customerToken()) return set({ ready: true })
  const { data, error } = await rpc<GoogleProfile | null>('customer_session')
  if (!error && !data) setCustomerToken(null) // expired
  set({ ready: true, profile: data ? toProfile(data) : null })
}
let started = false

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!started) {
    started = true
    void start()
  }
  return () => listeners.delete(listener)
}

export function useAccountLink() {
  const current = useSyncExternalStore(subscribe, () => state)

  /** Leaves the site for Google's account chooser and comes back to checkout. */
  const link = async (provider: SignInProvider) => {
    set({ error: null })
    const clientId = (await loadBasics())?.google_client_id
    if (!clientId) {
      return set({
        error: import.meta.env.DEV
          ? 'Google sign in is not set up: put the Google Client ID in google_client_id in hostinger/config.dev.php.'
          : `${PROVIDER_NAME[provider]} sign in is not available right now. Please try again later.`,
      })
    }
    const saved = { state: randomId(), nonce: randomId(), search: window.location.search }
    try {
      sessionStorage.setItem(SIGNIN_STATE_KEY, JSON.stringify(saved))
      sessionStorage.setItem(SIGNIN_RETURN_KEY, '1')
    } catch {
      return set({ error: 'Google sign in needs this browser to allow site data. Please turn off private browsing and try again.' })
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${window.location.origin}/checkout`,
      response_type: 'id_token',
      scope: 'openid email profile',
      state: saved.state,
      nonce: saved.nonce,
      // Always show the account chooser, so a shared phone doesn't silently reuse someone else's Gmail.
      prompt: 'select_account',
    })
    window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  }

  /** Signs out on this device only. */
  const unlink = async () => {
    await rpc('customer_sign_out')
    setCustomerToken(null)
    set({ profile: null })
  }

  return { ready: current.ready, profile: current.profile, error: current.error, link, unlink }
}
