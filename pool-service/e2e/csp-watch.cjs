// Preload for any e2e script (security hardening): fails the run if the browser blocked anything
// because of the app's Content-Security-Policy, so a too-strict policy can't break a screen unseen.
//   NODE_OPTIONS="--require /path/to/e2e/csp-watch.cjs" node <script>.cjs …
const pw = require('playwright');
const seen = [];
const watch = (ctx) => {
  ctx.on('console', (msg) => {
    if (/Content[- ]Security[- ]Policy/i.test(msg.text())) seen.push(msg.text().slice(0, 300));
  });
  return ctx;
};
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...o) => watch(await newContext(...o));
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...o) => {
    const page = await newPage(...o);
    watch(page.context());
    return page;
  };
  return browser;
};
process.on('exit', () => {
  if (!seen.length) return console.log('  (no content-policy blocks)');
  console.error(`FAILED: the content policy blocked ${seen.length} thing(s):\n  ${[...new Set(seen)].join('\n  ')}`);
  process.exitCode = 1;
});
