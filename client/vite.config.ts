import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
        timeout: 60 * 60 * 1000,
        proxyTimeout: 60 * 60 * 1000,
      },
    },
  },
  test: { environment: 'jsdom', setupFiles: './src/test-setup.ts', globals: true },
});
