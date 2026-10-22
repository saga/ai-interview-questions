import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import copilotSdkPlugin from './vite-plugin-copilot-sdk';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), copilotSdkPlugin()],
  server: {
    port: 5173,
    host: true,
    // 保留原有 Cloudflare 同源代理链路：Vite -> Express(3000) -> api.cloudflare.com。
    // Copilot SDK 则由上面的 Vite 插件独立提供，不经过 Express。
    proxy: {
      '/api/ai': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
