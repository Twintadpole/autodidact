// Every English text the app shows, collected from the source (GPF item 5), and a check that each
// language's dictionary has them all.
//   node client/scripts/i18n-keys.mjs            prints the keys as JSON (key → plural or not)
//   node client/scripts/i18n-keys.mjs --check es [vi …]   fails listing what a dictionary lacks
// Run from pool-service/. No dependencies.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = (dir, ext) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'i18n' ? [] : files(p, ext);
    return ext.some((x) => p.endsWith(x)) ? [p] : [];
  });
const keys = new Map(); // text → 'text' | 'plural'
const add = (k, kind = 'text') => {
  if (!k || !/[A-Za-z]/.test(k)) return;
  if (kind === 'plural' || !keys.has(k)) keys.set(k, kind);
};
// A JS string literal at the start of `s` ('…', "…" or `…` without ${}).
const STR = String.raw`'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\`(?:[^\`\\$]|\\.)*\``;
const unq = (lit) => lit.slice(1, -1).replace(/\\(.)/g, '$1');

for (const f of files(path.join(root, 'client/src'), ['.vue', '.ts'])) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(new RegExp(String.raw`(?<![\w.])\$?t\(\s*(${STR})`, 'g'))) add(unq(m[1]));
  for (const m of src.matchAll(new RegExp(String.raw`(?<![\w.])\$?tn\(\s*[^,]+,\s*(${STR})\s*,\s*(${STR})`, 'g'))) {
    add(unq(m[1]), 'text'); // the singular, for English only; dictionaries key plurals by the plural text
    keys.delete(unq(m[1]));
    add(unq(m[2]), 'plural');
  }
  // translated({ … }) / translatedOptions([ … ]): every quoted value inside.
  for (const m of src.matchAll(/translated(?:Options)?\(/g)) {
    let depth = 0, i = m.index + m[0].length - 1, end = i;
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++;
      else if (src[end] === ')' && --depth === 0) break;
    }
    const body = src.slice(i, end);
    for (const v of body.matchAll(new RegExp(String.raw`(?<![\w'])(?:label|(?!value\b)[\w']+)\s*:\s*(${STR})`, 'g'))) add(unq(v[1]));
  }
}
// Screen titles (routes), dashboard card titles, shared labels.
const grab = (file, re) => {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  for (const m of src.matchAll(re)) add(unq(m[1]));
};
grab('client/src/router/routes.ts', new RegExp(String.raw`title:\s*(${STR})`, 'g'));
grab('client/src/lib/dashboard.ts', new RegExp(String.raw`title:\s*(${STR})`, 'g'));
// Help topics (beta): every text is wrapped in h().
grab('client/src/lib/help.ts', new RegExp(String.raw`(?<![\w.])h\(\s*(${STR})`, 'g'));
grab('shared/src/readings.ts', new RegExp(String.raw`(?:label|short):\s*(${STR})`, 'g'));
grab('shared/src/schemas/import.ts', new RegExp(String.raw`label:\s*(${STR})`, 'g'));
for (const how of ['name and street', 'name', 'email', 'phone', 'Uncategorized']) add(how);
// Texts that come from data (e.g. phone labels), listed by hand.
for (const k of JSON.parse(fs.readFileSync(path.join(root, 'client/src/i18n/extra-keys.json'), 'utf8'))) add(k);
// The server's fixed messages (shown through errorMessage()).
for (const f of files(path.join(root, 'server/src'), ['.ts'])) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(new RegExp(String.raw`(?:message:|HttpError\(\d+,)\s*(${STR})`, 'g'))) {
    const s = unq(m[1]);
    if (m[1][0] !== '`' || !s.includes('${')) add(s);
  }
}
// Ledger categories (shared categoryLabel) are plain values in an object: pick them from its source.
{
  const src = fs.readFileSync(path.join(root, 'shared/src/schemas/collections.ts'), 'utf8');
  const block = src.match(/EXPENSE_CATEGORIES[^=]*=\s*\[([\s\S]*?)\][^;]*;/);
  if (block) for (const m of block[1].matchAll(new RegExp(String.raw`label:\s*(${STR})`, 'g'))) add(unq(m[1]));
}

const sorted = Object.fromEntries([...keys.entries()].sort(([a], [b]) => a.localeCompare(b)));
const args = process.argv.slice(2);
if (args[0] !== '--check') {
  console.log(JSON.stringify(sorted, null, 1));
  process.exit(0);
}
let bad = 0;
for (const code of args.slice(1)) {
  const dict = JSON.parse(fs.readFileSync(path.join(root, `client/src/i18n/${code}.json`), 'utf8'));
  const missing = Object.keys(sorted).filter((k) => !(k in dict));
  const extra = Object.keys(dict).filter((k) => !(k in sorted));
  const wrongShape = Object.keys(sorted).filter((k) => k in dict && sorted[k] === 'plural' && typeof dict[k] !== 'object');
  const lostPlaceholders = Object.keys(sorted).filter((k) => {
    if (!(k in dict)) return false;
    const want = [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    const plural = typeof dict[k] === 'object';
    const vals = plural ? Object.values(dict[k]) : [dict[k]];
    // A plural form may leave out {n} (Arabic "one pool" is one word); every other placeholder must stay.
    const need = [...new Set(want.split(','))].filter((x) => x && !(plural && x === 'n')).sort().join();
    return vals.some((v) => [...new Set([...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].filter((x) => !(plural && x === 'n')).sort().join() !== need);
  });
  console.log(`${code}: ${Object.keys(sorted).length} texts, ${missing.length} missing, ${extra.length} unused, ${wrongShape.length} need plural forms, ${lostPlaceholders.length} with wrong {placeholders}`);
  for (const k of missing.slice(0, 40)) console.log(`  missing: ${k}`);
  for (const k of wrongShape.slice(0, 20)) console.log(`  plural:  ${k}`);
  for (const k of lostPlaceholders.slice(0, 20)) console.log(`  {}:      ${k}`);
  if (missing.length || wrongShape.length || lostPlaceholders.length) bad = 1;
}
process.exit(bad);
