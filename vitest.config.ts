import { defineConfig } from 'vitest/config';

// 测试环境：纯 Node（domain / ai 层不依赖 DOM），独立于 vite.config.ts（不加载 react 插件）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
