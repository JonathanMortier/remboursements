import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Sur GitHub Pages le site est servi sous /<nom-du-dépôt>/ : le workflow définit BASE.
const base = process.env.BASE ?? '/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Remboursements',
        short_name: 'Rembours.',
        description: 'Dépenses à rembourser chaque mois',
        lang: 'fr',
        // Pas de start_url : l'appli installée s'ouvre sur l'adresse d'installation, y compris
        // le paramètre ?script=… du QR code (indispensable sur iPhone, dont l'appli installée
        // ne partage pas le stockage avec Safari).
        start_url: undefined,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f4f6f5',
        theme_color: '#0f766e',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            // Moteur Tesseract (worker, wasm) et données de langue « fra » chargés depuis jsDelivr.
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net',
            handler: 'CacheFirst',
            options: {
              cacheName: 'tesseract',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
