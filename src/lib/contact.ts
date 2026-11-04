import { useEffect, useState } from 'react'
import { rpc } from './api'

/** Owner's contact number from Admin → Settings ('' when not set). Loaded once per visit. */
let ownerPhone: Promise<string> | null = null
export function loadOwnerPhone(): Promise<string> {
  ownerPhone ??= Promise.resolve(rpc('get_owner_contact')).then(
    ({ data, error }) => {
      if (error) ownerPhone = null // try again next time
      return error ? '' : String((data as { phone?: string } | null)?.phone ?? '').trim()
    },
    () => {
      ownerPhone = null
      return ''
    },
  )
  return ownerPhone
}

/** The owner's number: null while loading, '' when not set. */
export function useOwnerPhone(enabled = true): string | null {
  const [phone, setPhone] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void loadOwnerPhone().then((p) => live && setPhone(p))
    return () => {
      live = false
    }
  }, [enabled])
  return phone
}

/** "0917 555 1234" → "tel:09175551234" */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
