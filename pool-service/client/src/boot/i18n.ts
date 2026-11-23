import { defineBoot } from '#q-app';
import { startLanguage, t, tn } from '@/i18n';

/** GPF item 5: `$t` / `$tn` in every template; the device's language before the first screen. */
declare module 'vue' {
  interface ComponentCustomProperties {
    $t: typeof t;
    $tn: typeof tn;
  }
}

export default defineBoot(async ({ app }) => {
  app.config.globalProperties.$t = t;
  app.config.globalProperties.$tn = tn;
  await startLanguage();
});
