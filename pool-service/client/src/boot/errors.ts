import { defineBoot } from '#q-app';
import { reportClientProblem } from '@/stores/api';
import { flushFeedback } from '@/lib/feedback';

/**
 * Beta: errors the app runs into are sent to the business's own server (no outside service), so they
 * can be found and fixed (tenant.sh errors). At most 10 per app start, each kind once. Also sends
 * feedback notes that waited for signal.
 */
export default defineBoot(({ app, router }) => {
  const seen = new Set<string>();
  let sent = 0;
  const report = (where: string, err: unknown) => {
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err ?? null));
    const key = `${where}|${e.message}`;
    if (seen.has(key) || sent >= 10) return;
    // Lost signal, and harmless ResizeObserver loop notices: not app errors.
    if (/Failed to fetch|NetworkError|Load failed|No connection to the server|ResizeObserver loop/i.test(e.message)) return;
    seen.add(key);
    sent++;
    void reportClientProblem(where, e.message || String(err), {
      stack: (e.stack ?? '').slice(0, 2000),
      screen: router.currentRoute.value.fullPath.slice(0, 200),
      appVersion: __APP_VERSION__,
    });
  };
  const previous = app.config.errorHandler;
  app.config.errorHandler = (err, instance, info) => {
    report(`vue:${info}`.slice(0, 60), err);
    if (previous) previous(err, instance, info);
    else console.error(err);
  };
  window.addEventListener('error', (ev) => report('window', ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => report('promise', ev.reason));
  router.onError((err) => report('router', err));

  window.addEventListener('online', () => void flushFeedback());
  setTimeout(() => void flushFeedback(), 5000);
});
