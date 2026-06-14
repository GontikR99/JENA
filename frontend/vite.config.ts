import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
  },
})
