import { useEffect, useId, useState, type ReactNode } from 'react'
import { Fish, Info, Phone } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn, formatPhone } from '@/lib/utils'
import { OWNER_MESSAGE_URL } from './common'
import { Button } from './ui/button'
import { Skeleton } from './ui/controls'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

/** Owner's contact number from Admin → Settings ('' when not set). Loaded once per visit. */
let ownerPhone: Promise<string> | null = null
function loadOwnerPhone(): Promise<string> {
  ownerPhone ??= Promise.resolve(supabase.rpc('get_owner_contact')).then(
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

function MessengerLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M.001 11.639C.001 4.949 5.241 0 12.001 0S24 4.95 24 11.639c0 6.689-5.24 11.638-12 11.638-1.21 0-2.38-.16-3.47-.46a.96.96 0 00-.64.05l-2.39 1.05a.96.96 0 01-1.35-.85l-.07-2.14a.97.97 0 00-.32-.68A11.39 11.389 0 01.002 11.64zm8.32-2.19l-3.52 5.6c-.35.53.32 1.139.82.75l3.79-2.87c.26-.2.6-.2.87 0l2.8 2.1c.84.63 2.04.4 2.6-.48l3.52-5.6c.35-.53-.32-1.13-.82-.75l-3.79 2.87c-.25.2-.6.2-.86 0l-2.8-2.1a1.8 1.8 0 00-2.61.48z" />
    </svg>
  )
}

/**
 * Wet Foods: a fish that isn't on the list can be asked for. The pop-up offers a call to the owner's number
 * (Admin → Settings, hidden when empty) and a message on the owner's Facebook page. Nothing goes to the cart.
 */
export function FishRequest({ className }: { className?: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <section aria-labelledby={`${id}-title`} className={cn('surface-card flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-6', className)}>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-ink">
        <Fish className="size-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h3 id={`${id}-title`} className="font-heading text-lg font-bold">
          Can't Find the Fish You're Looking For?
        </h3>
        <p className="mt-1 text-sm text-navy/70">
          Looking for a specific fish or seafood that is not available in our shop? Contact the owner directly to inquire about availability!
        </p>
      </div>
      <Button size="lg" className="w-full shrink-0 sm:w-auto" onClick={() => setOpen(true)}>
        <Fish /> Request a Fish
      </Button>
      <ContactOwnerDialog open={open} onOpenChange={setOpen} />
    </section>
  )
}

function ContactOwnerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [phone, setPhone] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    void loadOwnerPhone().then((p) => live && setPhone(p))
    return () => {
      live = false
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-cream p-5 sm:p-6">
        <DialogTitle>Looking for a Specific Fish?</DialogTitle>
        <DialogDescription>
          Can't find the fish or seafood you're looking for? No worries! You can contact our owner directly to ask about product availability, special requests, and pricing.
        </DialogDescription>

        <div className="mt-5 space-y-3">
          {phone === null ? (
            <Skeleton className="h-40 rounded-2xl bg-white" />
          ) : (
            phone && (
              <ContactCard
                icon={<Phone className="size-5" aria-hidden />}
                iconClass="bg-brand-50 text-brand-ink"
                title="Call the Owner"
                text={
                  <>
                    Business contact number
                    <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="mt-0.5 block font-heading text-lg font-bold text-navy tabular-nums hover:text-brand-ink">
                      {formatPhone(phone)}
                    </a>
                  </>
                }
                action={
                  <Button asChild className="w-full">
                    <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
                      <Phone /> Call the Owner
                    </a>
                  </Button>
                }
              />
            )
          )}
          <ContactCard
            icon={<MessengerLogo className="size-5" />}
            iconClass="bg-[#0084ff]/10 text-[#0866ff]"
            title="Message the Owner"
            text="Have questions about availability or pricing? Send us a message!"
            action={
              <Button asChild className="w-full">
                <a href={OWNER_MESSAGE_URL} target="_blank" rel="noopener noreferrer">
                  <MessengerLogo /> Message the Owner
                </a>
              </Button>
            }
          />
        </div>

        <p className="mt-4 flex gap-2 text-xs text-navy/65">
          <Info className="mt-px size-4 shrink-0 text-brand-ink" aria-hidden />
          <span>The owner confirms availability and price. Requested fish are not added to your cart.</span>
        </p>
      </DialogContent>
    </Dialog>
  )
}

function ContactCard({ icon, iconClass, title, text, action }: { icon: ReactNode; iconClass: string; title: string; text: ReactNode; action: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sand-200/70">
      <div className="flex items-start gap-3">
        <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-full', iconClass)}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-heading font-bold">{title}</p>
          <div className="mt-0.5 text-sm text-navy/70">{text}</div>
        </div>
      </div>
      <div className="mt-3">{action}</div>
    </div>
  )
}
