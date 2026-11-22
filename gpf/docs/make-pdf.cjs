// Turns one of these Markdown docs into a one-file PDF (Letter, printable), filling {{KEY}} values.
// Runs in the Playwright container (see "tenant.sh welcome"); no other dependencies.
//
//   node make-pdf.cjs <in.md> <out.pdf> [KEY=value …]
// Markdown subset: # / ## headings, paragraphs, "- " lists, "1. " lists, | tables |, **bold**, `code`.
const fs = require('node:fs');
const { chromium } = require('playwright');

const [src, out, ...pairs] = process.argv.slice(2);
const values = Object.fromEntries(pairs.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');

const md = fs.readFileSync(src, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : m));
const html = [];
let list = null;
let para = [];
const flushPara = () => {
  if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`);
  para = [];
};
const closeList = () => {
  if (list) html.push(`</${list}>`);
  list = null;
};
let table = null;
const closeTable = () => {
  if (!table) return;
  const [head, ...body] = table;
  html.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
  table = null;
};
for (const line of md.split('\n')) {
  let m;
  if (/^\|.*\|\s*$/.test(line)) {
    flushPara(); closeList();
    const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue; // the | --- | line
    (table ??= []).push(cells);
    continue;
  }
  closeTable();
  if ((m = line.match(/^(#{1,2}) (.*)$/))) {
    flushPara(); closeList();
    html.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
  } else if ((m = line.match(/^(- |\d+\. )(.*)$/))) {
    flushPara();
    const kind = m[1] === '- ' ? 'ul' : 'ol';
    if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; }
    html.push(`<li>${inline(m[2])}</li>`);
  } else if (!line.trim()) {
    flushPara(); closeList();
  } else {
    closeList();
    para.push(line.trim());
  }
}
flushPara(); closeList(); closeTable();

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-family: Roboto, 'Helvetica Neue', Arial, sans-serif; color: #1f2933; font-size: 11pt; line-height: 1.45; margin: 0; }
  h1 { color: #0b6bcb; font-size: 21pt; margin: 0 0 10pt; }
  h2 { color: #0b6bcb; font-size: 13pt; margin: 16pt 0 5pt; border-bottom: 1px solid #d5e3f3; padding-bottom: 2pt; }
  p { margin: 0 0 7pt; }
  ul, ol { margin: 0 0 7pt; padding-left: 18pt; }
  li { margin-bottom: 3pt; }
  code { font-family: monospace; background: #eef3f8; padding: 0 2pt; font-size: 9.5pt; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 8pt; font-size: 10pt; }
  th, td { border: 1px solid #d5e3f3; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { background: #eef3f8; }
  h2 { page-break-after: avoid; } tr { page-break-inside: avoid; }
</style></head><body>${html.join('\n')}</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const p = await browser.newPage();
  await p.setContent(page, { waitUntil: 'load' });
  await p.pdf({
    path: out,
    format: 'Letter',
    margin: { top: '0.7in', bottom: '0.8in', left: '0.8in', right: '0.8in' },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8pt;color:#7b8794;width:100%;text-align:center">Great Pool Friend. Created by S R Donaldson, all rights reserved. · <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
  });
  await browser.close();
  console.log(`PDF written: ${out}`);
})();
