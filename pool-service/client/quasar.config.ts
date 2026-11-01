// Quasar config: https://quasar.dev/quasar-cli-vite/quasar-config-file
import { fileURLToPath } from 'node:url';
import { defineConfig } from '#q-app';

export default defineConfig(() => ({
  boot: [],
  css: [],
  extras: ['material-icons', 'roboto-font'],

  build: {
    target: { browser: ['es2022', 'chrome115', 'firefox115', 'safari15'], node: 'node22' },
    typescript: { strict: true, vueShim: true },
    vueRouterMode: 'history',
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
