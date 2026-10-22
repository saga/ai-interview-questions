import { describe, expect, it } from 'vitest';
import type { ProviderEntry } from '../schemas/ai-config';
import { buildAgentRuntime, buildFallbackAgentRuntime, validAgentEntries } from './runtime';

const copilot: ProviderEntry = {
  id: 'copilot-sdk',
  enabled: true,
  model: 'auto',
  apiKey: '',
};

describe('Copilot SDK and pi-agent-core runtime boundary', () => {
  it('does not pretend the one-shot Copilot SDK provider supports pi-agent-core tools', () => {
    expect(() => buildAgentRuntime(copilot)).toThrow(/尚未接入 pi-agent-core/);
  });

  it('omits Copilot SDK from the Agent streaming fallback chain', () => {
    expect(validAgentEntries({ providers: [copilot] })).toEqual([]);
    expect(() => buildFallbackAgentRuntime([copilot])).toThrow(/没有可用于 Agent 面试的流式工具调用引擎/);
  });
});
