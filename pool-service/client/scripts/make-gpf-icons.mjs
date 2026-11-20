// Makes the placeholder Great Pool Friend icons in client/public/icons (GPF item 4): a white
// wave in a blue circle, the app's colour. Replace them once there is a real logo.
// Needs sharp (a server dependency):
//   NODE_PATH=server/node_modules:node_modules node client/scripts/make-gpf-icons.mjs client/public/icons
import sharp from 'sharp';
import path from 'node:path';

const out = process.argv[2] ?? 'client/public/icons';
const BLUE = '#0277bd';
// Two waves, drawn in a 100×100 box.
const waves = (color) => `
  <path d="M18 48 q8 -9 16 0 t16 0 t16 0 t16 0" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
  <path d="M18 64 q8 -9 16 0 t16 0 t16 0 t16 0" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" opacity="0.75"/>
  <circle cx="50" cy="30" r="7" fill="${color}"/>`;
const svg = {
  // Round icon on a transparent background.
  round: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="${BLUE}"/>${waves('#fff')}</svg>`,
  // Full-bleed square: Android crops it to its own shape (keep the art inside the middle 80%).
  maskable: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${BLUE}"/><g transform="translate(15 15) scale(0.7)">${waves('#fff')}</g></svg>`,
  // Square for Apple (it rounds the corners itself).
  apple: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${BLUE}"/><g transform="translate(8 8) scale(0.84)">${waves('#fff')}</g></svg>`,
  monochrome: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${waves('#fff')}</svg>`,
};
const files = [
  ...[128, 192, 256, 384, 512].map((s) => [`icon-${s}x${s}.png`, 'round', s]),
  ['icon-maskable-512x512.png', 'maskable', 512],
  ['icon-monochrome-512x512.png', 'monochrome', 512],
  ...[120, 152, 167, 180].map((s) => [`apple-icon-${s}x${s}.png`, 'apple', s]),
];
for (const [name, kind, size] of files) {
  await sharp(Buffer.from(svg[kind]), { density: 300 }).resize(size, size).png().toFile(path.join(out, name));
  console.log(name);
}
