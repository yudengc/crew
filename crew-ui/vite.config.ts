import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  css: {
    postcss: './postcss.config.js',
  },
  build: {
    assetsDir: 'assets',
    cssCodeSplit: false,
  },
})
