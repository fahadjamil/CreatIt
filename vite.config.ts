import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@components': resolve(__dirname, './src/components'),
      '@composables': resolve(__dirname, './src/composables'),
      '@utils': resolve(__dirname, './src/lib/utils'),
      '@ui': resolve(__dirname, './src/components/ui'),
      '@lib': resolve(__dirname, './src/lib'),
    },
  },
  root: '.',
  publicDir: 'public',
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: 'index.html' } },
});