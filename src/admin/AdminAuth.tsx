import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { adminSignedOut, adminToken, errorMessage, rpc, setAdminToken } from '@/lib/api'
import NotFound from '@/pages/NotFound'

type Status = 'loading' | 'signed_out' | 'admin'

interface AdminUser {
  email: string
}

interface AdminAuth {
  status: Status
  user: AdminUser | null
  signIn: (email: string, password: string) => Promise<string | null>
  /** First time only: creates the first admin with the setup key from config.php. */
  setup: (setupKey: string, email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AdminAuth | null>(null)

const normalizePath = (p: string) => '/' + p.replace(/^\/+|\/+$/g, '')
export const ADMIN_LOGIN_PATH = normalizePath((import.meta.env.VITE_ADMIN_PATH as string | undefined) || '/mgl-hub-admin-portal')

/** Wraps every admin route (login + /admin/*). Adds noindex and checks the saved admin sign in. */
export function AdminRoot() {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<AdminUser | null>(null)

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  const signedOut = useCallback(() => {
    setAdminToken(null)
    setUser(null)
    setStatus('signed_out')
  }, [])

  useEffect(() => {
    if (!adminToken()) return signedOut()
    void rpc<AdminUser | null>('admin_session').then(({ data, error }) => {
      // No answer (offline): keep the token and show the login; signing in again replaces it.
      if (error || !data) return error ? setStatus('signed_out') : signedOut()
      setUser(data)
      setStatus('admin')
    })
  }, [signedOut])

  // The server said the sign in expired (or another device changed the password).
  useEffect(() => {
    adminSignedOut.addEventListener('signedout', signedOut)
    return () => adminSignedOut.removeEventListener('signedout', signedOut)
  }, [signedOut])

  const finish = useCallback(async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await rpc<{ token: string; email: string }>(fn, args)
    if (error) return errorMessage(error)
    setAdminToken(data.token)
    setUser({ email: data.email })
    setStatus('admin')
    return null
  }, [])

  const signIn = useCallback<AdminAuth['signIn']>((email, password) => finish('admin_sign_in', { email, password }), [finish])
  const setup = useCallback<AdminAuth['setup']>(
    (setupKey, email, password) => finish('create_first_admin', { setup_key: setupKey, email, password }),
    [finish],
  )

  const signOut = useCallback(async () => {
    await rpc('admin_sign_out')
    signedOut()
  }, [signedOut])

  return (
    <Ctx.Provider value={{ status, user, signIn, setup, signOut }}>
      <Outlet />
    </Ctx.Provider>
  )
}

export function useAdminAuth(): AdminAuth {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAdminAuth must be used inside AdminRoot')
  return ctx
}

export function FullScreenSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-cream">
      <Loader2 className="size-8 animate-spin text-brand" />
    </div>
  )
}

/** Protects /admin/*. Non-admins get the normal 404 so the admin area stays hidden. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status } = useAdminAuth()
  if (status === 'loading') return <FullScreenSpinner />
  if (status !== 'admin') return <NotFound />
  return <>{children}</>
}
