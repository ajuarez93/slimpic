import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/core/index.ts', react: 'src/react/index.ts', vue: 'src/vue/index.ts', compat: 'src/compat.ts', heic: 'src/heic.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: true,
  treeshake: true,
  target: 'es2020',
  external: ['react', 'vue', 'heic-to'],
})
