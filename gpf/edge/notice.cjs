// "Temporarily unavailable" for a suspended tenant. Always 503 + Retry-After, so the phone app
// keeps unsent changes and retries; JSON for /api, a short page otherwise.
const http = require('node:http');
http
  .createServer((req, res) => {
    const api = req.url.startsWith('/api');
    res.writeHead(503, {
      'content-type': api ? 'application/json' : 'text/html; charset=utf-8',
      'retry-after': '3600',
      'cache-control': 'no-store',
    });
    res.end(
      api
        ? JSON.stringify({ error: 'unavailable', message: 'This account is paused. Your unsent work is kept on your phone.' })
        : '<!doctype html><meta name=viewport content="width=device-width"><title>Paused</title>' +
            '<body style="font-family:sans-serif;max-width:32em;margin:3em auto;padding:0 1em">' +
            '<h1>This account is paused</h1><p>Your data is safe. Work saved on your phone stays there and ' +
            'uploads when the account is back.</p><p>Please contact Great Pool Friend.</p>',
    );
  })
  .listen(8080);
