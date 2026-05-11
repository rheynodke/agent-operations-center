import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = '../../server/static/embed/v1';

// Post-build: flatten src/widget/index.html → widget.html at OUT_DIR root,
// then remove the leftover src/ dir. Vite preserves source-relative paths for
// HTML inputs by default, but we want the file at /embed/v1/widget.html so the
// loader's iframe.src resolves directly.
const flattenHtmlPlugin = () => ({
  name: 'flatten-widget-html',
  closeBundle() {
    const outAbs = path.resolve(__dirname, OUT_DIR);
    const nested = path.join(outAbs, 'src', 'widget', 'index.html');
    const flat = path.join(outAbs, 'widget.html');
    if (fs.existsSync(nested)) {
      fs.renameSync(nested, flat);
    }
    // Cleanup empty src/ tree
    const srcDir = path.join(outAbs, 'src');
    if (fs.existsSync(srcDir)) {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  },
});

export default defineConfig({
  // Asset paths in HTML get rewritten with this prefix; loader iframe expects
  // <script src="/embed/v1/widget.js">.
  base: '/embed/v1/',
  plugins: [preact(), flattenHtmlPlugin()],
  build: {
    target: 'es2020',
    outDir: OUT_DIR,
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: resolve(__dirname, 'src/widget/index.html'),
      output: {
        // Hashed filenames for cache-busting. widget.html references these via
        // their built names so browsers fetch the correct version automatically.
        entryFileNames: 'widget-[hash].js',
        chunkFileNames: 'widget-[name]-[hash].js',
        assetFileNames: 'widget-[name]-[hash][extname]',
      },
    },
    cssCodeSplit: false,
  },
  server: {
    port: 5174,
    cors: true,
  },
});
