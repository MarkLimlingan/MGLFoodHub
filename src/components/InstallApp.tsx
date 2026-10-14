import { useMemo, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import { CircleCheck, Download, Ellipsis, EllipsisVertical, ExternalLink, Share, SquarePlus, X, type LucideIcon } from 'lucide-react'
import { installPlatform, promptInstall, useInstallState, type InstallPlatform } from '@/lib/install'
import { cn, storage } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

const useInstallUI = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

/** Opens the browser's install popup where there is one (Android), otherwise the step by step guide (iPhone). */
export function useInstallApp() {
  const { installed } = useInstallState()
  const setOpen = useInstallUI((s) => s.setOpen)
  const install = async () => {
    const shown = await promptInstall()
    if (!shown) setOpen(true)
  }
  return { installed, install }
}

const STEPS: Record<InstallPlatform, { icon: LucideIcon; text: ReactNode }[]> = {
  ios: [
    { icon: Share, text: <>In Safari, tap the <b>Share</b> button. On newer iPhones, tap <b>⋯</b> first, then <b>Share</b>.</> },
    { icon: SquarePlus, text: <>Scroll down and tap <b>Add to Home Screen</b>.</> },
    { icon: CircleCheck, text: <>Tap <b>Add</b>. If you see <b>Open as Web App</b>, leave it on.</> },
  ],
  android: [
    { icon: EllipsisVertical, text: <>Tap the <b>⋮</b> menu at the top right of Chrome.</> },
    { icon: Download, text: <>Tap <b>Install app</b> or <b>Add to Home screen</b>.</> },
    { icon: CircleCheck, text: <>Tap <b>Install</b>. MGL Food Hub appears on your home screen.</> },
  ],
  'in-app': [
    { icon: Ellipsis, text: <>Tap the <b>⋯</b> menu at the top of this screen.</> },
    { icon: ExternalLink, text: <>Choose <b>Open in external browser</b> (Safari or Chrome).</> },
    { icon: Download, text: <>In that browser, tap <b>Install the app</b> again.</> },
  ],
  desktop: [
    { icon: Download, text: <>In Chrome or Edge, click the <b>install</b> icon at the right end of the address bar.</> },
    { icon: CircleCheck, text: <>Click <b>Install</b>. MGL Food Hub opens in its own window.</> },
  ],
}

const INTRO: Record<InstallPlatform, string> = {
  ios: 'Add MGL Food Hub to your home screen and open it like an app. No App Store needed.',
  android: 'Add MGL Food Hub to your home screen and open it like an app. No Play Store needed.',
  'in-app': "Facebook and Messenger can't add apps to your home screen. Open this page in your phone's browser first.",
  desktop: 'Add MGL Food Hub to your computer and open it in its own window.',
}

/** Rendered once in the customer layout; every Install button opens it. */
export function InstallDialog() {
  const { open, setOpen } = useInstallUI()
  const platform = useMemo(installPlatform, [])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <div className="flex items-center gap-3">
          <img src="/icon-192.png" alt="" className="size-14 shrink-0 rounded-2xl ring-1 ring-sand-200" />
          <DialogTitle>Install the app</DialogTitle>
        </div>
        <DialogDescription className="mt-3">{INTRO[platform]}</DialogDescription>
        <ol className="mt-5 space-y-3">
          {STEPS[platform].map(({ icon: Icon, text }, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-navy/80">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sand text-brand-600">
                <Icon className="size-[18px]" />
              </span>
              <span className="pt-2">{text}</span>
            </li>
          ))}
        </ol>
        <Button className="mt-6 w-full" variant="navy" onClick={() => setOpen(false)}>
          Got it
        </Button>
      </DialogContent>
    </Dialog>
  )
}

const DISMISS_KEY = 'mgl_install_banner_dismissed'

/** Phones and tablets only, until installed or dismissed. */
export function InstallBanner({ className }: { className?: string }) {
  const { installed, install } = useInstallApp()
  const platform = useMemo(installPlatform, [])
  const [dismissed, setDismissed] = useState(() => storage.get(DISMISS_KEY, false))
  if (installed || dismissed || platform === 'desktop') return null
  return (
    <section aria-label="Install the app" className={cn('flex items-center gap-3 rounded-2xl bg-navy p-3 text-white shadow-lg shadow-navy/15 animate-fade-up', className)}>
      <img src="/icon-192.png" alt="" className="size-12 shrink-0 rounded-xl bg-white" />
      <div className="min-w-0 flex-1">
        <p className="font-heading text-sm font-semibold leading-snug">Get the MGL Food Hub app</p>
        <p className="text-xs text-white/70">Order from your home screen. No app store needed.</p>
      </div>
      <Button size="sm" onClick={() => void install()}>
        <Download /> Install
      </Button>
      <button
        type="button"
        onClick={() => {
          storage.set(DISMISS_KEY, true)
          setDismissed(true)
          toast('You can still install the app from the bottom of any page.')
        }}
        className="rounded-full p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
        aria-label="Hide install banner"
      >
        <X className="size-4" />
      </button>
    </section>
  )
}

/** Footer link, on every customer page until the app is installed. */
export function InstallLink({ className }: { className?: string }) {
  const { installed, install } = useInstallApp()
  if (installed) return null
  return (
    <button type="button" onClick={() => void install()} className={className}>
      Install the app
    </button>
  )
}
