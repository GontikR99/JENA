import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

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
  plugins: [react()],
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
      'src/main/__tests__/**/*.test.ts',
      'src/main/__tests__/**/*.test.tsx',
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
