import { defineConfig } from 'vitest/config';

// 测试环境：纯 Node（domain / ai 层不依赖 DOM），独立于 vite.config.ts（不加载 react 插件）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // 超时按「并行满载」而非「单文件单跑」设定。
    // src/ai/local.test.ts 与 src/ai/provider.test.ts 的端到端用例要真实跑 pi-ai 的
    // SSE 流式解析：单跑 1.2s / 0.8s，但全量 65 个文件并发时（每个 worker 都要 import
    // 6MB 的 pi-ai dist）会超过 vitest 默认的 5000ms，表现为「Test timed out」——
    // 与被测逻辑无关的负载抖动。这里留 4× 余量。
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
