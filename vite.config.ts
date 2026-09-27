import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const baseUrl = '/Guitar-Pedalboard/';

export default defineConfig({
  base: baseUrl,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png'],
      manifest: {
        name: 'Guitar Pedalboard',
        short_name: 'Pedalboard',
        description: '브라우저에서 연주하고 녹음하는 웹 기타 멀티 이펙터',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b0f16',
        theme_color: '#0b0f16',
        start_url: baseUrl,
        scope: baseUrl,
        icons: [
          {
            src: `${baseUrl}pwa-192x192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${baseUrl}pwa-512x512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: `${baseUrl}index.html`,
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/[^/]+\/Guitar-Pedalboard\//,
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'guitar-pedalboard-runtime',
              networkTimeoutSeconds: 4,
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
