// P1-3（DeepSeek KV Cache）：验证 prompt_cache_hit_tokens / miss_tokens → pi-ai Usage → LLMUsage 映射。
//
// 背景（已核对 pi-ai 源码 `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js` 的
// `parseChunkUsage`，DeepSeek 走此 OpenAI-completions 适配器）：
//
//   DeepSeek 原始 usage（流式最后一帧）:
//     prompt_tokens                    = 总 prompt token
//     prompt_cache_hit_tokens          = 命中磁盘 prefix cache 的 token（= KV Cache 命中）
//     prompt_cache_miss_tokens         = 未命中、需重新计算的 token
//     prompt_tokens_details.cache_write_tokens = 本请求写入缓存的 token（首轮通常 >0，后续 0）
//
//   pi-ai 的归一化（`parseChunkUsage`）:
//     cacheRead = prompt_cache_hit_tokens
//     cacheWrite = cache_write_tokens
//     input     = prompt_tokens − cacheRead − cacheWrite   // 注意：是「重新计算/未命中」部分，不是总 prompt
//
//   因此 piUsageToLLMUsage 接收的是「已归一化」的 Usage，正确的还原应为：
//     cacheMiss    = input + cacheWrite                       (= prompt_tokens − 命中)
//     inputTokens  = cacheHit + cacheMiss                      (= 原始 prompt_tokens)
//     hitRate      = cacheHit / inputTokens
//
//   旧实现 (cacheMiss = input − cacheHit) 在 cacheRead>0 时恒为负 → 被 max(0,..) 截成 0，
//   命中率被伪装成 100%。本测试锁死修正后的正确映射。
//
// 注：这里直接在「pi-ai 已归一化」的 Usage 形状上断言（即 piUsageToLLMUsage 的真实入参），
// 等价于用一次真实 DeepSeek 响应的归一化结果验证整条映射；pi-ai 上游的归一化已在源码确认。

import { describe, it, expect } from 'vitest';
import type { Usage } from '@earendil-works/pi-ai';
import { piUsageToLLMUsage } from './pi';

/** 构造一个「pi-ai 归一化后」的 Usage（入参形状与 parseChunkUsage 产出一致）。 */
function normalizedUsage(input: number, cacheRead: number, cacheWrite: number, output: number, reasoning = 0): Usage {
  return { input, output, cacheRead, cacheWrite, reasoning } as Usage;
}

describe('DeepSeek KV Cache 映射（piUsageToLLMUsage）', () => {
  it('R1 全 miss（首轮写入缓存，0 命中）→ 命中率 0%', () => {
    // DeepSeek: prompt_tokens=50, hit=0, miss=50, cache_write=50
    // pi-ai: input = 50−0−50 = 0, cacheRead=0, cacheWrite=50
    const u = normalizedUsage(0, 0, 50, 12);
    const r = piUsageToLLMUsage(u);
    expect(r.inputTokens).toBe(50); // = prompt_tokens
    expect(r.cacheHitTokens).toBe(0);
    expect(r.cacheMissTokens).toBe(50); // input + cacheWrite = 0 + 50
    expect(r.outputTokens).toBe(12);
    expect(r.cacheHitTokens / r.inputTokens).toBe(0);
  });

  it('R2 高命中（复用首轮缓存）→ 命中率 90%', () => {
    // DeepSeek: prompt_tokens=200, hit=180, miss=20, cache_write=0
    // pi-ai: input = 200−180−0 = 20, cacheRead=180, cacheWrite=0
    const u = normalizedUsage(20, 180, 0, 30);
    const r = piUsageToLLMUsage(u);
    expect(r.inputTokens).toBe(200); // = 180 + 20
    expect(r.cacheHitTokens).toBe(180);
    expect(r.cacheMissTokens).toBe(20); // input + cacheWrite = 20 + 0（非 input − cacheHit = 负值！）
    expect(Math.round(r.cacheHitTokens / r.inputTokens * 100)).toBe(90);
  });

  it('R3 接近全命中 → 命中率 95%（回归：旧公式会算出 100% 假象）', () => {
    // DeepSeek: prompt_tokens=400, hit=380, miss=20, cache_write=0
    // pi-ai: input = 400−380 = 20
    const u = normalizedUsage(20, 380, 0, 40);
    const r = piUsageToLLMUsage(u);
    expect(r.cacheMissTokens).toBe(20); // 旧实现：max(0, 20−380)=0 → 错误
    expect(r.inputTokens).toBe(400);
    expect(Math.round(r.cacheHitTokens / r.inputTokens * 100)).toBe(95);
  });

  it('无 cache provider / 全量未命中（input 即总 prompt，cacheRead=0）', () => {
    const u = normalizedUsage(10, 0, 0, 5);
    const r = piUsageToLLMUsage(u);
    expect(r.inputTokens).toBe(10);
    expect(r.cacheHitTokens).toBe(0);
    expect(r.cacheMissTokens).toBe(10);
    expect(Math.round(r.cacheHitTokens / r.inputTokens * 100)).toBe(0);
  });

  it('reasoning token 透传', () => {
    const u = normalizedUsage(20, 180, 0, 30, 15);
    const r = piUsageToLLMUsage(u);
    expect(r.reasoningTokens).toBe(15);
  });
});
