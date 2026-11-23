// Translation review sheets (beta segment 5): one Excel file per language for a native speaker, and
// the import of their corrections. Run from pool-service/.
//
//   node client/scripts/i18n-review.mjs export <code…> [--out <dir>]
//        <dir>/<code>-review.xlsx: "How to review" + "Texts" (English, the app's translation now,
//        Your correction, Comment, where it's used). Plurals: one row per form.
//   node client/scripts/i18n-review.mjs import <code> <file.xlsx> [--dry-run]
//        applies every "Your correction" to client/src/i18n/<code>.json. Refused (listed, not applied):
//        a correction whose {placeholders} differ from the English, or a row that's no longer in the app.
//        Comments are printed so they can be answered.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs';

const root = process.cwd();
const I18N = path.join(root, 'client/src/i18n');
const NAMES = { es: 'Español', vi: 'Tiếng Việt', zh: '中文（简体）', tl: 'Tagalog', ar: 'العربية' };
const FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const die = (m) => { console.error(`Error: ${m}`); process.exit(1); };
const readDict = (code) => JSON.parse(fs.readFileSync(path.join(I18N, `${code}.json`), 'utf8'));
const writeDict = (code, dict) =>
  fs.writeFileSync(path.join(I18N, `${code}.json`), JSON.stringify(Object.fromEntries(Object.entries(dict).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 1));
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

/** Every English text and where it's used (the first screen or file that shows it). */
function keysWithPlaces() {
  const keys = JSON.parse(execFileSync(process.execPath, [path.join(root, 'client/scripts/i18n-keys.mjs')], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'i18n', 'dist'].includes(e.name)) walk(p); }
      else if (/\.(vue|ts)$/.test(e.name)) files.push([p, fs.readFileSync(p, 'utf8')]);
    }
  };
  walk(path.join(root, 'client/src'));
  walk(path.join(root, 'shared/src'));
  walk(path.join(root, 'server/src'));
  const place = (k) => {
    // The text as a quoted string (short words like "Done" appear everywhere unquoted).
    const quoted = [`'${k.replace(/'/g, "\\'")}'`, `"${k}"`, `\`${k}\``];
    const hit = files.find(([, src]) => quoted.some((q) => src.includes(q))) ?? files.find(([, src]) => src.includes(k));
    if (!hit) return '';
    const rel = path.relative(root, hit[0]);
    const m = rel.match(/([A-Za-z]+?)(Page|Layout|Card|Dialog|Fields|Sheet|Editor)?\.vue$/);
    if (m) return `${m[1].replace(/([a-z])([A-Z])/g, '$1 $2')}${m[2] ? ` (${m[2].toLowerCase()})` : ''}`;
    if (rel.includes('lib/help.ts')) return 'Help';
    if (rel.startsWith('server/')) return 'Message from the server';
    return path.basename(rel, path.extname(rel));
  };
  return Object.entries(keys).map(([k, kind]) => ({ key: k, kind, where: place(k) }));
}

const HOW = [
  'Thank you for reviewing! This sheet lists every text the app shows, in English, with the translation it uses now.',
  '',
  'How to review',
  '1. Go through the "Texts" tab. Read the English, then the translation now.',
  '2. If the translation is wrong, unclear or sounds unnatural, write a better one in "Your correction" (yellow). Leave it empty if the translation is fine.',
  '3. Keep everything in {curly braces} exactly as it is, e.g. {name}, {n}, {date}. The app puts a name, a number or a date there. You may move it within the sentence.',
  '4. Plural rows ("form: one", "form: few", …) are the same sentence for different numbers. Your language may need only some of them.',
  '5. Use "Comment" for questions or notes (for example: "this word depends on context").',
  '6. Who reads it: pool service technicians and owners in the US, on a phone, often outdoors. Short, plain, everyday words are best.',
  '7. Keep these as they are: the app name "Great Pool Friend", and water-test short names (FC, pH, CYA, TA, CH).',
  '8. "Where" says which screen shows the text, to help with context.',
  '',
  'When you are done, save the file (keep it as .xlsx) and send it back.',
];

async function exportSheets(codes, outDir) {
  const rows = keysWithPlaces();
  fs.mkdirSync(outDir, { recursive: true });
  for (const code of codes) {
    if (!NAMES[code]) die(`unknown language ${code} (${Object.keys(NAMES).join(', ')})`);
    const dict = readDict(code);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Great Pool Friend';
    const how = wb.addWorksheet('How to review');
    how.getColumn(1).width = 110;
    how.addRow([`Great Pool Friend: translation review, ${NAMES[code]} (${code})`]).font = { bold: true, size: 14 };
    how.addRow([]);
    for (const line of HOW) {
      const r = how.addRow([line]);
      r.alignment = { wrapText: true, vertical: 'top' };
      if (line === 'How to review') r.font = { bold: true };
    }
    const ws = wb.addWorksheet('Texts', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Key', key: 'key', width: 10, hidden: true },
      { header: 'Form', key: 'form', width: 10, hidden: true },
      { header: '#', key: 'n', width: 6 },
      { header: 'English', key: 'en', width: 48 },
      { header: `Translation now (${code})`, key: 'now', width: 48 },
      { header: 'Your correction', key: 'fix', width: 48 },
      { header: 'Comment', key: 'comment', width: 30 },
      { header: 'Where', key: 'where', width: 22 },
    ];
    ws.getRow(1).font = { bold: true };
    let n = 0;
    for (const { key, kind, where } of rows) {
      const entry = dict[key];
      if (kind === 'plural') {
        const forms = typeof entry === 'object' && entry ? Object.keys(entry).sort((a, b) => FORMS.indexOf(a) - FORMS.indexOf(b)) : ['other'];
        for (const f of forms) ws.addRow({ key, form: f, n: ++n, en: `${key}   (form: ${f})`, now: typeof entry === 'object' && entry ? (entry[f] ?? '') : (entry ?? ''), where });
      } else {
        ws.addRow({ key, form: '', n: ++n, en: key, now: typeof entry === 'string' ? entry : '', where });
      }
    }
    ws.eachRow((r, i) => {
      r.alignment = { wrapText: true, vertical: 'top' };
      if (i > 1) r.getCell('fix').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8D6' } };
    });
    ws.autoFilter = { from: 'C1', to: 'H1' };
    const out = path.join(outDir, `${code}-review.xlsx`);
    await wb.xlsx.writeFile(out);
    console.log(`${out}: ${n} rows`);
  }
}

const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
  if (typeof v === 'object' && 'text' in v) return String(v.text);
  return String(v);
};

async function importSheet(code, file, dry) {
  if (!NAMES[code]) die(`unknown language ${code}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('Texts');
  if (!ws) die('no "Texts" tab in that file');
  const head = {};
  ws.getRow(1).eachCell((c, i) => { head[cellText(c.value)] = i; });
  for (const h of ['Key', 'Form', 'Your correction', 'Comment']) if (!head[h]) die(`column "${h}" is missing`);
  const known = new Map(keysWithPlaces().map((r) => [r.key, r.kind]));
  const dict = readDict(code);
  const applied = [];
  const refused = [];
  const comments = [];
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const key = cellText(r.getCell(head.Key).value);
    const form = cellText(r.getCell(head.Form).value);
    const fix = cellText(r.getCell(head['Your correction']).value).trim();
    const comment = cellText(r.getCell(head.Comment).value).trim();
    if (comment) comments.push(`row ${i}: ${key}${form ? ` (${form})` : ''}: ${comment}`);
    if (!fix || !key) return;
    if (!known.has(key)) return refused.push(`row ${i}: no longer in the app: ${key}`);
    const want = placeholders(key);
    const got = placeholders(fix);
    const pluralNoN = form && want.split(',').filter((p) => p !== 'n').join(',') === got; // a plural form may leave out {n}
    if (got !== want && !pluralNoN) return refused.push(`row ${i}: placeholders {${got}} differ from the English {${want}}: ${fix}`);
    if (form) {
      const cur = typeof dict[key] === 'object' && dict[key] ? { ...dict[key] } : { other: typeof dict[key] === 'string' ? dict[key] : key };
      if (cur[form] === fix) return;
      cur[form] = fix;
      dict[key] = cur;
    } else {
      if (dict[key] === fix) return;
      dict[key] = fix;
    }
    applied.push(`row ${i}: ${key}${form ? ` (${form})` : ''} → ${fix}`);
  });
  console.log(`${code}: ${applied.length} correction(s) ${dry ? 'would be applied' : 'applied'}, ${refused.length} refused, ${comments.length} comment(s)`);
  for (const l of applied) console.log(`  applied  ${l}`);
  for (const l of refused) console.log(`  REFUSED  ${l}`);
  for (const l of comments) console.log(`  comment  ${l}`);
  if (!dry && applied.length) writeDict(code, dict);
}

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(name); if (i < 0) return undefined; const v = rest[i + 1]; rest.splice(i, 2); return v; };
if (cmd === 'export') {
  const out = opt('--out') ?? path.join(root, 'i18n-review');
  await exportSheets(rest.length ? rest : Object.keys(NAMES), out);
} else if (cmd === 'import') {
  const dry = rest.includes('--dry-run');
  const [code, file] = rest.filter((a) => a !== '--dry-run');
  if (!code || !file) die('import <code> <file.xlsx> [--dry-run]');
  await importSheet(code, file, dry);
} else {
  die('export <code…> [--out <dir>] | import <code> <file.xlsx> [--dry-run]');
}
