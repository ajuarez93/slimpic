import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      'slimpic/react': resolve(__dirname, '../src/react/index.ts'),
      'slimpic/vue': resolve(__dirname, '../src/vue/index.ts'),
      'slimpic/compat': resolve(__dirname, '../src/compat.ts'),
      'slimpic/heic': resolve(__dirname, '../src/heic.ts'),
      slimpic: resolve(__dirname, '../src/core/index.ts'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(__dirname, 'index.html'), vue: resolve(__dirname, 'vue.html') } },
  },
})
