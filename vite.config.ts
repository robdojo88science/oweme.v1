import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.VITE_BASE_PATH || '/';
export default defineConfig({
  base,
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg', 'apple-touch-icon.png'],
    manifest: {
      id: base, name: 'OweMe · Lending notebook', short_name: 'OweMe',
      description: 'Private lending records, instant calculations, and receipts. Works offline.',
      theme_color: '#6B4EFF', background_color: '#F7F8FB', display: 'standalone',
      start_url: base, scope: base, lang: 'en-PH',
      icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    },
    workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'], navigateFallback: 'index.html', cleanupOutdatedCaches: true, maximumFileSizeToCacheInBytes: 4000000 },
  })],
  build: { chunkSizeWarningLimit: 1100 },
  test: { include: ['src/**/*.test.ts'] },
});
