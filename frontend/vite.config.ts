import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

function getAllowedHosts() {
  const value = process.env.JENA_VITE_ALLOWED_HOSTS
  if (!value) {
    return undefined
  }

  if (value === 'all' || value === 'true') {
    return true
  }

  return value
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host.length > 0)
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        id: '/',
        name: "Jephine's Event Notification Apparatus",
        short_name: 'JENA',
        description:
          'Web-based EverQuest trigger alerts, timers, subscriptions, and broadcasts.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#111111',
        icons: [
          {
            src: '/pwa-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
      },
    }),
  ],
  server: {
    allowedHosts: getAllowedHosts(),
    proxy: {
      '/_jena': {
        target: process.env.JENA_BACKEND_URL ?? 'http://127.0.0.1:8080',
        ws: true,
      },
    },
  },
  test: {
    include: [
      'src/bridges/**/__tests__/**/*.test.ts',
      'src/bridges/**/__tests__/**/*.test.tsx',
      'src/characters/__tests__/**/*.test.ts',
      'src/characters/__tests__/**/*.test.tsx',
      'src/generated/__tests__/**/*.test.ts',
      'src/generated/__tests__/**/*.test.tsx',
      'src/triggers/__tests__/**/*.test.ts',
      'src/triggers/__tests__/**/*.test.tsx',
      'src/pip/__tests__/**/*.test.ts',
      'src/pip/__tests__/**/*.test.tsx',
      'src/shared/__tests__/**/*.test.ts',
      'src/shared/__tests__/**/*.test.tsx',
      'src/worker/__tests__/**/*.test.ts',
      'src/worker/__tests__/**/*.test.tsx',
    ],
    setupFiles: ['src/test/setup.ts'],
  },
})
