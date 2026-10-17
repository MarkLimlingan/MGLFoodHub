import { useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { addDays } from '@/lib/utils'

let cached: Promise<{ today: string; min_date: string } | null> | null = null

/** "Sun, Oct 18" for a "YYYY-MM-DD" date. */
const shortDay = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })

/** "tomorrow" or "Sun, Oct 18": the first day customers can book (from the server's cutoff rules). */
export function useEarliestDelivery(): string | null {
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!supabaseConfigured) return
    cached ??= Promise.resolve(supabase.rpc('get_checkout_info')).then(
      ({ data }) => (data as { today: string; min_date: string } | null) ?? null,
      () => null,
    )
    let alive = true
    void cached.then((d) => {
      if (!alive || !d?.min_date) return
      setLabel(d.min_date === addDays(d.today, 1) ? 'tomorrow' : shortDay(d.min_date))
    })
    return () => {
      alive = false
    }
  }, [])
  return label
}
