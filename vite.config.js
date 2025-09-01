import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vercel本番: base='/'; GitHub Pages: base='/scribble-translator/'
export default defineConfig({
  // Vercel/Netlifyはルート配信、GitHub Pagesはサブパス
  base: (process.env.VERCEL || process.env.NETLIFY) ? '/' : '/scribble-translator/',
  plugins: [react()],
})
