import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // GitHub Pages serves this project under its repository name, whereas Vercel
  // serves it from the domain root. Vercel exposes the VERCEL environment
  // variable for every deployment build.
  const baseUrl = loadEnv(mode, '.', '').VERCEL ? '/' : '/Guitar-Pedalboard/';
  // `vite build --mode test` 는 오디오 렌더 프로브(probe.html)만 빌드한다. 배포용 앱·PWA 와는 관계가 없다.
  const isProbeBuild = mode === 'test';

  return {
  base: isProbeBuild ? '/' : baseUrl,
  plugins: [
    react(),
    ...(isProbeBuild ? [] : [VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo-520.webp', 'logo-1040.webp', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        // 앱의 식별자와 언어(S2.14). id 는 start_url 과 같게 두어 이미 설치한 사용자의 앱 식별이 바뀌지 않게 한다.
        id: baseUrl,
        lang: 'ko',
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
          {
            // 가운데 지름 80% 원 안에만 그림이 있다(docs/refactoring/tools/make-maskable-icon.mjs). 'any' 와 한 항목으로 묶지 않는다.
            src: `${baseUrl}pwa-512x512-maskable.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,png,webp,ico,svg,webmanifest}'],
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
    })]),
  ],
  build: {
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      ...(isProbeBuild ? { input: { probe: 'probe.html' } } : {}),
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
  };
});
