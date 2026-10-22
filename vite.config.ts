import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import copilotSdkPlugin from './vite-plugin-copilot-sdk';

export default defineConfig({
  plugins: [react(), copilotSdkPlugin()],
  server: {
    port: 5173,
    host: true,
    // Cloudflare Workers AI 的代理由 Vite 直接转发到固定上游，不依赖额外 HTTP 服务。
    proxy: {
      '/api/ai': {
        target: 'https://api.cloudflare.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/ai/, ''),
      },
    },
  },
});
