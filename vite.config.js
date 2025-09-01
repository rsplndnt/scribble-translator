import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vercel本番: base='/'; GitHub Pages: base='/scribble-translator/'
export default defineConfig({
  base: process.env.VERCEL ? '/' : '/scribble-translator/',
  plugins: [react()],
})
