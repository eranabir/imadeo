import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const devPort = Number.parseInt(process.env.VITE_DEV_PORT ?? '5173', 10);
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:6666';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: devPort,
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
        target: apiProxyTarget,
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
