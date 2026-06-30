import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const publicBasePath = process.env.VITE_PUBLIC_BASE_PATH || '/'

// https://vite.dev/config/
export default defineConfig({
  base: publicBasePath,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    setupFiles: './src/setupTests.js',
  },
})
