import { computed, ref } from 'vue';
import { Lang } from 'quasar';
import { LANGUAGES, matchLanguage, type LanguageCode } from '@pool/shared';

/**
 * The app's translator (GPF item 5). The English text is the key: `t('Pool name')`. A language's
 * dictionary maps it to that language; anything missing shows in English, so nothing breaks.
 * Placeholders: `t('{n} pools on the route', { n })`. Plurals: `tn(n, '{n} pool', '{n} pools')`;
 * a dictionary gives the plural forms its language needs ({ one, few, many, other, … }), chosen
 * with the browser's own plural rules. Dates and numbers: Intl with `locale.value`.
 *
 * The language follows the person (My account, saved on the server); before login, this device's
 * last choice or the phone's own language.
 */
export type Plural = Partial<Record<Intl.LDMLPluralRule, string>>;
export type Dictionary = Record<string, string | Plural>;

const KEY = 'pool.lang';
const dictionaries: Partial<Record<LanguageCode, Dictionary>> = {};
const loaders: Record<Exclude<LanguageCode, 'en'>, () => Promise<{ default: Dictionary }>> = {
  es: () => import('./es.json'),
  vi: () => import('./vi.json'),
  zh: () => import('./zh.json'),
  tl: () => import('./tl.json'),
  ar: () => import('./ar.json'),
};
/** Quasar's own words (dialog buttons, date pickers). No Tagalog pack: English there. */
const quasarPacks: Record<string, () => Promise<{ default: unknown }>> = {
  'en-US': () => import('quasar/lang/en-US.js'),
  es: () => import('quasar/lang/es.js'),
  vi: () => import('quasar/lang/vi.js'),
  'zh-CN': () => import('quasar/lang/zh-CN.js'),
  ar: () => import('quasar/lang/ar.js'),
};

function initial(): LanguageCode {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return matchLanguage(saved);
  } catch {
    // private mode
  }
  return matchLanguage(typeof navigator !== 'undefined' ? navigator.language : 'en');
}

/** The current language (reactive: screens re-render when it changes). */
export const lang = ref<LanguageCode>('en');
/** Set when the dictionary for `lang` is loaded (until then English shows). */
const ready = ref(0);
export const locale = computed(() => ({ en: 'en-US', es: 'es-US', vi: 'vi-VN', zh: 'zh-CN', tl: 'fil-PH', ar: 'ar' })[lang.value]);
export const isRtl = computed(() => LANGUAGES.find((l) => l.code === lang.value)?.rtl ?? false);

const fill = (text: string, params?: Record<string, unknown>) =>
  params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k] ?? '') : m)) : text;

/** Translate one text. */
export function t(text: string, params?: Record<string, unknown>): string {
  void ready.value; // re-render when a dictionary arrives
  const entry = lang.value === 'en' ? undefined : dictionaries[lang.value]?.[text];
  const out = typeof entry === 'string' ? entry : typeof entry === 'object' ? (entry.other ?? text) : text;
  return fill(out, params);
}

/** Translate a count: `tn(n, '{n} pool', '{n} pools')`; {n} is filled in. */
export function tn(n: number, one: string, other: string, params?: Record<string, unknown>): string {
  void ready.value;
  const all = { n: n.toLocaleString(locale.value), ...params };
  if (lang.value === 'en') return fill(n === 1 ? one : other, all);
  const entry = dictionaries[lang.value]?.[other];
  if (entry === undefined) return fill(n === 1 ? one : other, all);
  if (typeof entry === 'string') return fill(entry, all);
  const form = new Intl.PluralRules(locale.value).select(n);
  return fill(entry[form] ?? entry.other ?? other, all);
}

/** An object whose values are English labels, translated each time they're read. */
export function translated<T extends Record<string, string>>(labels: T): T {
  return new Proxy(labels, { get: (o, k) => (typeof k === 'string' && k in o ? t(o[k as keyof T] as string) : Reflect.get(o, k)) });
}
/** Select options with English labels, translated each time they're read. */
export function translatedOptions<T extends { label: string }>(options: T[]): T[] {
  return options.map((o) => new Proxy(o, { get: (x, k) => (k === 'label' ? t(x.label) : Reflect.get(x, k)) }));
}

/** "5 minutes ago" / "hace 5 minutos", in the current language. */
export function timeAgo(when: Date | string | number, now = Date.now()): string {
  void ready.value;
  const secs = Math.round((new Date(when).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];
  for (const [unit, size] of units) if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  return rtf.format(secs, 'second');
}

export async function setLanguage(code: LanguageCode): Promise<void> {
  if (code !== 'en' && !dictionaries[code]) dictionaries[code] = (await loaders[code]()).default;
  const info = LANGUAGES.find((l) => l.code === code)!;
  const pack = quasarPacks[info.quasar];
  if (pack) Lang.set(((await pack()) as { default: Parameters<typeof Lang.set>[0] }).default);
  lang.value = code;
  ready.value++;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // private mode
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = code;
    document.documentElement.dir = info.rtl ? 'rtl' : 'ltr';
  }
}

/** At start-up: this device's last language, or the phone's. */
export const startLanguage = () => setLanguage(initial());
