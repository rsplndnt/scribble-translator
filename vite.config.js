import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/scribble-translator/',
  server: {
    port: 3000,
    open: '/scribble-translator/'  // 自動でブラウザを開く
  }
})
