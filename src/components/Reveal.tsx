import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

/**
 * Scroll reveal: content fades up once as it enters the screen.
 * One shared IntersectionObserver for the whole page; the motion itself is plain CSS
 * ([data-reveal] in index.css), so it stays smooth and honours reduced-motion settings.
 */
let io: IntersectionObserver | null = null

const show = (el: Element) => el.setAttribute('data-revealed', '')

function observer(): IntersectionObserver {
  io ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        show(e.target)
        io?.unobserve(e.target)
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  )
  return io
}

export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Old browsers: just show it.
    if (typeof IntersectionObserver === 'undefined') return show(el)
    const obs = observer()
    obs.observe(el)
    return () => obs.unobserve(el)
  }, [])
  return ref
}

/** Wrap anything that should fade up on scroll. `delay` (ms) staggers items in a row. */
export function Reveal({
  children,
  delay = 0,
  className,
  style,
  ...rest
}: { children: ReactNode; delay?: number } & HTMLAttributes<HTMLDivElement>) {
  const ref = useReveal<HTMLDivElement>()
  return (
    <div ref={ref} data-reveal="" className={className} style={{ ...style, '--reveal-delay': `${delay}ms` } as CSSProperties} {...rest}>
      {children}
    </div>
  )
}
