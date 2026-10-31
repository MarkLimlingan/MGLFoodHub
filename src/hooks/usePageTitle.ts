import { useEffect } from 'react'

export const DEFAULT_TITLE = 'MGL Food Hub · Scheduled Food Delivery'

/** Sets the browser tab title ("Checkout · MGL Food Hub") while the page is open. */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · MGL Food Hub`
    return () => {
      document.title = DEFAULT_TITLE
    }
  }, [title])
}
