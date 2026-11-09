import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/ — set VITE_BASE in CI (deploy workflow does this).
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
