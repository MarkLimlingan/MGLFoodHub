import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const VIDEO = { desktop: '/hero/hero-desktop.mp4', mobile: '/hero/hero-mobile.mp4' }
const POSTER = { desktop: '/hero/hero-desktop.webp', mobile: '/hero/hero-mobile.webp' }
const PHONE = '(max-width: 767px)'
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

type NetworkInfo = { saveData?: boolean; effectiveType?: string }

/** Skip the video for reduced motion, Data Saver and very slow connections: the poster stays. */
function videoAllowed() {
  if (window.matchMedia(REDUCED_MOTION).matches) return false
  const net = (navigator as Navigator & { connection?: NetworkInfo }).connection
  return !(net?.saveData || /(^|-)2g$/.test(net?.effectiveType ?? ''))
}

/** Hero background: poster paints first, muted looping video loads after the page and fades in. Fills its positioned parent. */
export function HeroVideo({ className }: { className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [posterOk, setPosterOk] = useState(true)

  useEffect(() => {
    const phone = window.matchMedia(PHONE)
    const reduced = window.matchMedia(REDUCED_MOTION)
    const pick = () => (phone.matches ? VIDEO.mobile : VIDEO.desktop)
    let idle = 0
    const start = () => {
      if (!videoAllowed()) return
      idle = window.requestIdleCallback ? window.requestIdleCallback(() => setSrc(pick()), { timeout: 1500 }) : window.setTimeout(() => setSrc(pick()), 300)
    }
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })

    const onPhone = () => setSrc((s) => (s ? pick() : s))
    const onReduced = () => {
      if (reduced.matches) {
        setSrc(null)
        setVisible(false)
      }
    }
    phone.addEventListener('change', onPhone)
    reduced.addEventListener('change', onReduced)
    return () => {
      window.removeEventListener('load', start)
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle)
      window.clearTimeout(idle)
      phone.removeEventListener('change', onPhone)
      reduced.removeEventListener('change', onReduced)
    }
  }, [])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = true
    v.defaultMuted = true
    // Plays by itself whenever the hero is on screen; paused while scrolled away to save battery.
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) v.play().catch(() => {})
      else v.pause()
    })
    io.observe(v)
    return () => io.disconnect()
  }, [src])

  return (
    <div className={cn('absolute inset-0 overflow-hidden bg-navy', className)}>
      {posterOk && (
        <picture>
          <source media={PHONE} srcSet={POSTER.mobile} />
          <img
            src={POSTER.desktop}
            alt=""
            fetchPriority="high"
            decoding="async"
            onError={() => setPosterOk(false)}
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
        </picture>
      )}
      {src && (
        <video
          ref={videoRef}
          key={src}
          src={src}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
          aria-hidden
          onPlaying={() => setVisible(true)}
          onError={() => {
            setSrc(null)
            setVisible(false)
          }}
          className={cn(
            'pointer-events-none absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700',
            visible ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  )
}
