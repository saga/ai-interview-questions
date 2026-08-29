import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // 本地开发时让 /api/ai/* 也走同源代理（与生产 Worker 行为一致），
    // 仅转发 cloudflare-workers-ai 的请求到 api.cloudflare.com，规避浏览器 CORS。
    proxy: {
      '/api/ai': {
        target: 'https://api.cloudflare.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ai/, ''),
      },
    },
  },
});
