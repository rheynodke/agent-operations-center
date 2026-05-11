import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    target: 'es2020',
    outDir: '../../server/static/embed/loader-build',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/loader/index.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'loader.js',
        inlineDynamicImports: true,
      },
    },
    minify: 'terser',
  },
});
