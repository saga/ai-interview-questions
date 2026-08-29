import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // 本地开发时让 /api/ai/* 也走同源代理。为保持「代理只有一份实现」，这里把请求
    // 转发到本地可选的 Node server（server/index.js，端口 3000），由它再服务端转发到
    // api.cloudflare.com，与生产的可选 server 行为完全一致（不再直连 cloudflare）。
    proxy: {
      '/api/ai': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
