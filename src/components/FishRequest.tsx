import { useId, useRef, useState } from 'react'
import { Fish, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn, copyText } from '@/lib/utils'
import { OWNER_MESSAGE_URL } from './common'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Field } from './ui/label'

/**
 * Wet Foods: ask for a fish that isn't on the list. The owner is reached on their Facebook page, which can't
 * be pre-filled, so tapping the button copies the request and opens the page, ready to paste in the chat.
 */
export function FishRequest({ className }: { className?: string }) {
  const id = useId()
  const fishRef = useRef<HTMLInputElement>(null)
  const [fish, setFish] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | undefined>()

  const message = [
    "Hi! I'd like to request a fish for delivery.",
    `Fish: ${fish.trim()}`,
    amount.trim() && `How much: ${amount.trim()}`,
    'Is it available, and how much is it?',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <section aria-labelledby={`${id}-title`} className={cn('surface-card rounded-2xl p-5 sm:p-6', className)}>
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-ink">
          <Fish className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="font-heading text-lg font-bold">
            Don't see your fish? Request it
          </h3>
          <p className="mt-1 text-sm text-navy/70">Tell us what fish you want. The owner will check if it's available and confirm the price.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Field label="What kind of fish?" htmlFor={`${id}-fish`} required error={error}>
          <Input
            ref={fishRef}
            id={`${id}-fish`}
            value={fish}
            onChange={(e) => {
              setFish(e.target.value)
              setError(undefined)
            }}
            placeholder="e.g. Lapu-lapu, Galunggong"
            maxLength={80}
            aria-invalid={!!error}
          />
        </Field>
        <Field label="How much?" htmlFor={`${id}-amount`} optional>
          <Input id={`${id}-amount`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1 kilo" maxLength={40} />
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button asChild variant="navy">
          <a
            href={OWNER_MESSAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (!fish.trim()) {
                e.preventDefault()
                setError('Please tell us what fish you want.')
                fishRef.current?.focus()
                return
              }
              // Copy right away (still inside the tap), then let the link open the owner's page.
              void copyText(message).then((ok) =>
                ok
                  ? toast.success('Request copied. Paste it in the chat with the owner.')
                  : toast('Type your fish request in the chat with the owner.'),
              )
            }}
          >
            <MessageCircle /> Message the owner
          </a>
        </Button>
        <p className="text-xs text-navy/70">Opens the owner's Facebook page. Your request is copied, so just paste it in the chat.</p>
      </div>
    </section>
  )
}
