import { describe, it, expect } from 'vitest';
import { capabilitiesFor, type LLMCapabilities } from './capabilities';
import type { ProviderEntry } from '../schemas/ai-config';

function entry(id: ProviderEntry['id']): ProviderEntry {
  return { id, apiKey: 'k', model: 'm', enabled: true };
}

describe('capabilitiesFor（P2⑦ 能力协商）', () => {
  it('deepseek 声明全部能力（jsonMode / toolCalls / thinking / contextCaching / multiRound）', () => {
    const c = capabilitiesFor(entry('deepseek'));
    expect(c).toEqual<LLMCapabilities>({
      jsonMode: true,
      toolCalls: true,
      thinking: true,
      contextCaching: true,
      multiRound: true,
    });
  });

  it('openrouter 支持 jsonMode + toolCalls，但 contextCaching 保守为 false', () => {
    const c = capabilitiesFor(entry('openrouter'));
    expect(c.jsonMode).toBe(true);
    expect(c.toolCalls).toBe(true);
    expect(c.contextCaching).toBe(false);
  });

  it('chrome 不声明原生 jsonMode / toolCalls（走 prompt + parser 兜底）', () => {
    const c = capabilitiesFor(entry('chrome'));
    expect(c.jsonMode).toBe(false);
    expect(c.toolCalls).toBe(false);
  });

  it('未知引擎回退保守默认：仅 multiRound 为 true', () => {
    const c = capabilitiesFor(entry('does-not-exist' as ProviderEntry['id']));
    expect(c).toEqual<LLMCapabilities>({
      jsonMode: false,
      toolCalls: false,
      thinking: false,
      contextCaching: false,
      multiRound: true,
    });
  });
});
