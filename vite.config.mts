import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `vite build` makes the desktop renderer (loaded from a file, so relative paths). `vite build --mode web` makes
// the static website for Cloudflare, with its headers and other public files taken from web/public.
export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  return {
    plugins: [react()],
    base: web ? '/' : './',
    publicDir: web ? 'web/public' : false,
    build: { outDir: web ? 'dist-web' : 'dist' },
    test: { include: ['tests/**/*.test.ts'] },
  };
});
