import { computed, reactive } from 'vue';

/**
 * Branding (GPF item 4): the business's name and logo from Business details, else the product's
 * (Great Pool Friend). Read from the home-screen file (/manifest.json), which needs no login,
 * so the login screen can show it; the last answer is kept on the device for offline starts.
 */
const KEY = 'pool.branding';
export const PRODUCT = 'Great Pool Friend';

interface Brand {
  product: string;
  business: string | null;
  logo: string | null;
}
function saved(): Brand {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Brand | null;
    if (v && typeof v.product === 'string') return v;
  } catch {
    // nothing saved yet
  }
  return { product: PRODUCT, business: null, logo: null };
}

export const brand = reactive<Brand>(saved());
/** What the app calls itself: the business's name, else the product's. */
export const appName = computed(() => brand.business || brand.product);

export async function refreshBranding(): Promise<void> {
  try {
    const res = await fetch('/manifest.json', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return;
    const m = (await res.json()) as { gpf?: Partial<Brand> };
    if (!m.gpf) return;
    Object.assign(brand, { product: m.gpf.product || PRODUCT, business: m.gpf.business ?? null, logo: m.gpf.logo ?? null });
    localStorage.setItem(KEY, JSON.stringify(brand));
  } catch {
    // offline: keep the saved one
  } finally {
    if (typeof document !== 'undefined') document.title = appName.value;
  }
}
