// The Hostinger PHP API (hostinger/public_html/api). rpc() answers like
// supabase.rpc() did: { data, error }. Sign ins are tokens kept in this browser
// and sent with every call: X-Admin-Token (admins) and X-Customer-Token (Google).

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) || '/api').replace(/\/$/, '')
const ADMIN_TOKEN_KEY = 'mgl_admin_token'
const CUSTOMER_TOKEN_KEY = 'mgl_customer_token'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* private mode: signed in for this page only */
  }
}

export const adminToken = () => read(ADMIN_TOKEN_KEY)
export const setAdminToken = (token: string | null) => write(ADMIN_TOKEN_KEY, token)
export const customerToken = () => read(CUSTOMER_TOKEN_KEY)
export const setCustomerToken = (token: string | null) => write(CUSTOMER_TOKEN_KEY, token)

/** Fired when the server says the admin sign in has expired, so the admin pages can sign out. */
export const adminSignedOut = new EventTarget()

export interface ApiError {
  message: string
  status: number
}
export type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiError }

function headers(): Record<string, string> {
  const h: Record<string, string> = {}
  const admin = adminToken()
  const customer = customerToken()
  if (admin) h['X-Admin-Token'] = admin
  if (customer) h['X-Customer-Token'] = customer
  return h
}

async function call<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(url, { ...init, headers: { ...headers(), ...init.headers } })
  } catch {
    return { data: null, error: { message: 'Failed to fetch', status: 0 } }
  }
  const body = (await res.json().catch(() => null)) as { data?: T; error?: string; [k: string]: unknown } | null
  if (!res.ok || !body || typeof body.error === 'string') {
    if (res.status === 401 && adminToken()) adminSignedOut.dispatchEvent(new Event('signedout'))
    return { data: null, error: { message: body?.error ?? `Something went wrong (${res.status}). Please try again.`, status: res.status } }
  }
  return { data: ('data' in body ? body.data : body) as T, error: null }
}

/** Calls a function in api/rpc.php (same names and arguments as the old Supabase RPCs). */
export function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<ApiResult<T>> {
  return call<T>(`${BASE}/rpc.php?fn=${encodeURIComponent(fn)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
}

/** Like rpc(), but throws the error instead (for Promise.all and try/catch code). */
export async function rpcOrThrow<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await rpc<T>(fn, args)
  if (error) throw error
  return data as T
}

/** A payment screenshot (api/proof.php): returns its path for the order. */
export async function uploadProof(file: File, device: string): Promise<string> {
  const body = new FormData()
  body.append('device', device)
  body.append('file', file)
  const { data, error } = await call<{ path?: string }>(`${BASE}/proof.php`, { method: 'POST', body })
  if (error || !data?.path) throw new Error(error?.message || 'Could not upload your payment screenshot. Please try again.')
  return data.path
}

/** An admin photo upload (api/upload.php): returns its /uploads/… URL. */
export async function uploadImage(kind: 'product-images' | 'store-assets', folder: string, file: File): Promise<string> {
  const body = new FormData()
  body.append('kind', kind)
  body.append('folder', folder)
  body.append('file', file)
  const { data, error } = await call<{ url?: string }>(`${BASE}/upload.php`, { method: 'POST', body })
  if (error || !data?.url) throw new Error(error?.message || 'Could not upload the image. Please try again.')
  return data.url
}

/** A payment screenshot for the admin, as a blob: URL (call URL.revokeObjectURL when done). */
export async function proofImageUrl(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/proof.php?path=${encodeURIComponent(path)}`, { headers: headers() })
    return res.ok ? URL.createObjectURL(await res.blob()) : null
  } catch {
    return null
  }
}

/** Turns an API error into a friendly message. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback
  const msg = typeof err === 'string' ? err : (err as { message?: string }).message
  if (!msg) return fallback
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'No internet connection. Please check your signal and try again.'
  if (/Not authorized/i.test(msg)) return 'You are not allowed to do that.'
  return msg
}
