import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [tailwindcss()],
  build: { rollupOptions: { onwarn(warning, warn) {
    if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
    if (warning.code === 'SOURCEMAP_ERROR' && warning.id?.includes('/vendor/darwin-ui/')) return;
    warn(warning);
  }, input: {
    studio: fileURLToPath(new URL('./index.html', import.meta.url)),
    quick: fileURLToPath(new URL('./quick.html', import.meta.url)),
  } } },
});
