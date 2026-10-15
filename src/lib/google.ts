import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface GoogleProfile {
  name: string
  email: string | null
  picture: string | null
}

/** Set before leaving for Google, so the guidelines popup doesn't reopen on the way back. */
export const GOOGLE_RETURN_KEY = 'mgl_google_return'

/** The customer's Google details, or null when they haven't linked Google on this device. */
export function googleProfile(user: User | null): GoogleProfile | null {
  if (!user) return null
  const app = user.app_metadata ?? {}
  const providers: unknown[] = Array.isArray(app.providers) ? app.providers : [app.provider]
  if (!providers.includes('google')) return null
  const meta = user.user_metadata ?? {}
  return {
    name: meta.full_name || meta.name || user.email || 'Google user',
    email: user.email || meta.email || null,
    picture: meta.avatar_url || meta.picture || null,
  }
}

/** Local testing only (npm run dev): show the Google step without the admin switch. ?nogoogle hides it. */
export const devGooglePreview = () => import.meta.env.DEV && !new URLSearchParams(window.location.search).has('nogoogle')

let requiredCheck: Promise<boolean> | null = null

/** Whether the admin switched on "Require Google account at checkout" (checked once per page load). */
export function useGoogleRequired(): boolean {
  const [required, setRequired] = useState(devGooglePreview)
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
  return message?.replace(/\+/g, ' ') || 'Google did not finish linking your account.'
}

// Read once when the site loads, so whichever part of the page asks first doesn't swallow it for the rest.
const returnError = typeof window === 'undefined' ? null : takeReturnError()

export function useGoogleLink() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(returnError)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  /** Leaves the site for Google and comes back to checkout. */
  const link = async () => {
    setError(null)
    try {
      sessionStorage.setItem(GOOGLE_RETURN_KEY, '1')
    } catch {
      /* private mode: the guidelines popup just shows again */
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/checkout${window.location.search}`,
        // Always show the account chooser, so a shared phone doesn't silently reuse someone else's Gmail.
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) setError(error.message)
  }

  /** Unlinks Google on this device only. */
  const unlink = async () => {
    await supabase.auth.signOut({ scope: 'local' })
  }

  return { ready, profile: googleProfile(user), error, link, unlink }
}
