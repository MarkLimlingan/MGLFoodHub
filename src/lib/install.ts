import { useSyncExternalStore } from 'react'

/** Chrome / Edge / Samsung Internet on Android (and desktop) fire this when the site can be installed. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallPlatform = 'ios' | 'android' | 'in-app' | 'desktop'

interface InstallState {
  /** The browser's own install popup is ready to show. */
  canPrompt: boolean
  /** Running from the home screen, or just installed. */
  installed: boolean
}

let deferred: BeforeInstallPromptEvent | null = null
let state: InstallState = { canPrompt: false, installed: isStandalone() }
const listeners = new Set<() => void>()

function update(next: Partial<InstallState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

// Registered when this module loads (from main.tsx), before React renders: the event can fire early.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // our own Install button shows the popup instead of Chrome's mini bar
    deferred = e as BeforeInstallPromptEvent
    update({ canPrompt: true })
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    update({ canPrompt: false, installed: true })
  })
}

export function installPlatform(): InstallPlatform {
  const ua = navigator.userAgent
  // Facebook, Messenger and Instagram's built-in browsers can't add to the home screen.
  if (/FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram/i.test(ua)) return 'in-app'
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Shows the browser's install popup. Returns false when it isn't available, so the caller can show instructions. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred
  if (!e) return false
  deferred = null // the event can only be used once
  update({ canPrompt: false })
  try {
    await e.prompt()
  } catch {
    return false // the browser refused the popup; show the instructions instead
  }
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') update({ installed: true })
  return true
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* the site works the same without it; it just can't show the install popup */
    })
  })
}
