// Preload for running the e2e scripts on the VPS against http://127.0.0.1:3000/ (the public URL's
// API is behind Cloudflare Access, the emailed-code login). Test-only.
//
// 1. Playwright's Node-side ctx.request won't send a Secure cookie over plain http, so this adds the
//    context's cookies to those requests by hand.
// 2. With E2E_SESSION set (a short-lived session from `server/dist/cli/e2e-session.js`), every new
//    browser context starts logged in, and the login screen's POST /api/auth/login is answered
//    here, so no password is stored for the tests. The password argument can be anything.
//
//   E2E_SESSION=$(docker compose exec -T api node server/dist/cli/e2e-session.js)
//   NODE_OPTIONS="--require /e2e/local-cookies.cjs" node visit-extras.cjs http://127.0.0.1:3000/ unused <out>
const pw = require('playwright');

const session = process.env.E2E_SESSION;

const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...opts) => {
    const ctx = await newContext(...opts);
    if (session) {
      await ctx.addCookies([{ name: 'pool.sid', value: session, domain: '127.0.0.1', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
      await ctx.route('**/api/auth/login', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
          : route.continue(),
      );
    }
    const req = ctx.request;
    for (const m of ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch']) {
      const orig = req[m].bind(req);
      req[m] = async (url, o = {}) => {
        const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
        return orig(url, { ...o, headers: { ...(o.headers || {}), ...(cookie ? { cookie } : {}) } });
      };
    }
    return ctx;
  };
  return browser;
};
