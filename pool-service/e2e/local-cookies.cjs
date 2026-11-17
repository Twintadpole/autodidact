// Preload for running the e2e scripts on the VPS against http://127.0.0.1:3000/ (the public URL is
// behind Cloudflare Access, the emailed-code login). The browser keeps the app's Secure session
// cookie on 127.0.0.1, but Playwright's Node-side ctx.request won't send a Secure cookie over
// plain http, so this adds the context's cookies to those requests by hand. Test-only.
//
//   NODE_OPTIONS="--require /e2e/local-cookies.cjs" node visit-extras.cjs http://127.0.0.1:3000/ <pw> <out>
const pw = require('playwright');

const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...opts) => {
    const ctx = await newContext(...opts);
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
