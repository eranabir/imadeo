import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const appDirectory = dirname(fileURLToPath(import.meta.url));
const certificateDirectory = resolve(appDirectory, '../.dev/certs');
const keyPath = resolve(certificateDirectory, 'localhost-key.pem');
const certificatePath = resolve(certificateDirectory, 'localhost.pem');
const https =
  existsSync(keyPath) && existsSync(certificatePath)
    ? { key: readFileSync(keyPath), cert: readFileSync(certificatePath) }
    : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    https,
    // Bind every interface rather than just ::1. This keeps the app reachable on
    // 127.0.0.1 as well as localhost, and lets a phone on the same network open
    // it while the mobile client is being worked on.
    host: true,
    // Same-origin in development so cookies and media URLs behave exactly as
    // they will behind the production nginx.
    proxy: {
      '/api': {
        target: 'https://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
        headers: { 'X-Forwarded-Proto': 'https' },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
