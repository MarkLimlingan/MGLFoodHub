import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = (env.VITE_API_TARGET || 'http://127.0.0.1:8710').replace(/\/$/, '')
  const isRemote = /^https?:\/\//i.test(apiTarget) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(apiTarget)
  const proxy = { target: apiTarget, changeOrigin: isRemote }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    // npm run dev: /api and /uploads proxy to VITE_API_TARGET (e.g. https://mglfoodhub.com) or local npm run dev:api.
    server: {
      proxy: { '/api': proxy, '/uploads': proxy },
    },
  }
})
