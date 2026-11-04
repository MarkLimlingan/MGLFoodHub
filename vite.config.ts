import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // npm run dev: /api (and admin photo uploads) go to the PHP server started by npm run dev:api.
  server: {
    proxy: { '/api': 'http://127.0.0.1:8710', '/uploads': 'http://127.0.0.1:8710' },
  },
})
