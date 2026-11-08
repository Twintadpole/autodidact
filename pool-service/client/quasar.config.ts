// Quasar config: https://quasar.dev/quasar-cli-vite/quasar-config-file
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '#q-app';

const appVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig(() => ({
  boot: [],
  css: [],
  extras: ['material-icons', 'roboto-font'],

  build: {
    target: { browser: ['es2022', 'chrome115', 'firefox115', 'safari15'], node: 'node22' },
    typescript: { strict: true, vueShim: true },
    vueRouterMode: 'history',
    // Shown on the More screen.
    define: { __APP_VERSION__: JSON.stringify(appVersion), __BUILT_AT__: JSON.stringify(new Date().toISOString()) },
    alias: {
      // Use the shared package's TypeScript source directly (no build step in dev).
      '@pool/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },

  devServer: {
    port: 9000,
    open: false,
    // The API runs on :3000 in development (`npm run dev` at the repo root).
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },

  framework: {
    config: {
      brand: { primary: '#0277bd', secondary: '#26a69a', accent: '#9c27b0', warning: '#f2a900', negative: '#c10015' },
    },
    plugins: ['Notify', 'Dialog'],
  },

  animations: [],

  pwa: {
    // Custom service worker (src-pwa/sw/custom-sw.ts): app-shell precache
    // now, Background Sync of the outbox in Phase 4.
    workboxMode: 'InjectManifest',
    swFilename: 'sw.js',
    manifestFilename: 'manifest.json',
    injectPwaMetaTags: true,
    useCredentialsForManifestTag: false,
  },
}));
