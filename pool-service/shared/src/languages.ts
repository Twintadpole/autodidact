/**
 * Languages (GPF item 5): the six most spoken in the US. English is the source text; the others
 * are "beta" until a native speaker has checked them. Arabic is written right to left.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', beta: false, rtl: false, quasar: 'en-US' },
  { code: 'es', name: 'Español', beta: true, rtl: false, quasar: 'es' },
  { code: 'vi', name: 'Tiếng Việt', beta: true, rtl: false, quasar: 'vi' },
  { code: 'zh', name: '中文（简体）', beta: true, rtl: false, quasar: 'zh-CN' },
  { code: 'tl', name: 'Tagalog', beta: true, rtl: false, quasar: 'en-US' },
  { code: 'ar', name: 'العربية', beta: true, rtl: true, quasar: 'ar' },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]['code'];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]];

/** The closest supported language for a browser locale ("es-MX" → "es", "zh-Hans-CN" → "zh"). */
export function matchLanguage(locale: string | null | undefined): LanguageCode {
  const base = String(locale ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  const alias: Record<string, LanguageCode> = { fil: 'tl' };
  const code = alias[base] ?? base;
  return (LANGUAGE_CODES as readonly string[]).includes(code) ? (code as LanguageCode) : 'en';
}
