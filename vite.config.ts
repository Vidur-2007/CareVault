import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// FROZEN after Phase 0. Request changes in docs/contract-requests-<side>.md.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverPort = env.PORT || '8787';

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'CareVault',
          short_name: 'CareVault',
          description: 'A family health passport for medicines and medical records.',
          theme_color: '#0B6E6E',
          background_color: '#F2F6F6',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // App shell only. OCR models, wasm and sample documents load on demand.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
    server: {
      proxy: {
        '/api': { target: `http://localhost:${serverPort}`, changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
