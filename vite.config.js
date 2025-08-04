import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/scribble-translator/',
  build: {
    rollupOptions: {
      external: ['kuromoji']
    }
  },
  optimizeDeps: {
    exclude: ['kuromoji']
  }
})
