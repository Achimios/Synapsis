import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { index: resolve('index.html'), reactflow: resolve('reactflow.html'), tldraw: resolve('tldraw.html') } } },
});
