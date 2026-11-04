import { useCallback, useEffect, useState } from 'react'
import { rpc, errorMessage } from '@/lib/api'
import type { PublicOrder } from '@/lib/types'

/** How often an open tracking page checks for changes. */
const POLL_MS = 15_000

/**
 * Loads one order by its tracking token and keeps it up to date: re-read
 * through get_order_by_token every few seconds while the page is visible,
 * and right away when the customer comes back to it.
 */
export function useTrackedOrder(token: string | undefined) {
  const [order, setOrder] = useState<PublicOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    const { data, error } = await rpc('get_order_by_token', { p_token: token })
    if (error) {
      setError(errorMessage(error))
    } else if (!data) {
      setNotFound(true)
    } else {
      const o = data as PublicOrder
      setOrder({
        ...o,
        subtotal: Number(o.subtotal),
        delivery_fee: Number(o.delivery_fee),
        total: Number(o.total),
        items: o.items.map((i) => ({ ...i, unit_price: Number(i.unit_price), line_total: Number(i.line_total) })),
      })
      setError(null)
    }
    setLoading(false)
  }, [token])

  useEffect(() => {
    if (!token) return
    void load()
    const poll = setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [token, load])

  return { order, loading, error, notFound, reload: load }
}
