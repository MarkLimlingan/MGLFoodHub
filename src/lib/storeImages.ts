import type { Store } from './types'

/**
 * Store card pictures for customer pages.
 *
 * A store's "cover" in the data is its printed menu board: busy, mostly text, sometimes with
 * store hours that differ from our delivery window. These are clean 4:3 images made from the
 * stores' own food photos or logos (public/stores). They only apply while the store still
 * uses its original board; a cover uploaded in the admin always wins.
 */
const CARD_IMAGES: Record<string, string> = {
  'judy-anns-crispy-pata': '/stores/judy-anns-crispy-pata.webp',
  'okoy-ni-jay-r': '/stores/okoy-ni-jay-r.webp',
  'hazels-special-puto': '/stores/hazels-special-puto.webp',
  'sisig-ni-mutik': '/stores/sisig-ni-mutik.webp',
  'rody-days': '/stores/rody-days.webp',
  'aurings-special-pancit-malabon': '/stores/aurings-special-pancit-malabon.webp',
  'original-benjie-puto-pao': '/stores/original-benjie-puto-pao.webp',
  'anny-dading-peachy-peachy': '/stores/anny-dading-peachy-peachy.webp',
  'balsa-sa-niugan': '/stores/balsa-sa-niugan.webp',
}

/** The picture for a store card, or null when the store has no good one (show a name tile instead). */
export function storeCardImage(store: Pick<Store, 'slug' | 'cover_image_url'>): string | null {
  const original = `/menus/${store.slug}.jpg`
  if (store.cover_image_url && store.cover_image_url !== original) return store.cover_image_url
  return CARD_IMAGES[store.slug] ?? null
}
