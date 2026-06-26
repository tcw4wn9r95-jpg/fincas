import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Relative base ('./') makes the build portable: it works when served from a
// sub-path (a CDN preview like raw.githack.com, or GitHub Pages project path
// /fincas/) as well as from a domain root. Override with FINCAS_BASE if needed.
const base = process.env.FINCAS_BASE ?? './'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CasaresSan Finances — Personal Financial Advisor',
        short_name: 'CasaresSan',
        description:
          'A private, on-device personal financial advisor: cash-flow forecasts, monthly money dates, and a Claude assistant for your finances.',
        theme_color: '#1f3d34',
        background_color: '#f6f3ec',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // pdfjs worker can be large; raise the cache limit.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
})
