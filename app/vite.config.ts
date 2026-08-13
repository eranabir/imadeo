import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Bind every interface rather than just ::1. This keeps the app reachable on
    // 127.0.0.1 as well as localhost, and lets a phone on the same network open
    // it while the mobile client is being worked on.
    host: true,
    // Development can be reached through a LAN IP, DDNS name, or temporary
    // tunnel. Accept all Host headers here; production is served by nginx.
    allowedHosts: true,
    // Same-origin in development so cookies and media URLs behave exactly as
    // they will behind the production nginx.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:6666',
        changeOrigin: true,
        headers: { 'X-Forwarded-Proto': 'http' },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
