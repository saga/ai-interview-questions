// 工具调用 JSON 识别：Chrome 引擎的 prompt-based 工具调用协议识别。
// 这层判断同时决定两件事——解析层「能否当作工具调用」、展示层「能否给用户看」，
// 所以既要认得出各种包裹形态，也要对自然语言零误判。

import { describe, expect, it } from 'vitest';
import { extractJsonObject, looksLikeToolCall, toolCallName } from './toolCallJson';

describe('extractJsonObject', () => {
  it('抽出裸 JSON 对象', () => {
    expect(extractJsonObject('{"tool":"getQuestion","args":{"id":"q1"}}')).toEqual({
      tool: 'getQuestion',
      args: { id: 'q1' },
    });
  });

  it('兼容 ``` 代码块包裹', () => {
    expect(extractJsonObject('```json\n{"tool":"getUserWeaknesses","args":{}}\n```')).toEqual({
      tool: 'getUserWeaknesses',
      args: {},
    });
  });

  it('正文里先出现花括号时，以代码块为准而不是「首个 { 到末个 }」', () => {
    // 回归：没有 fence 分支时，兜底切片会从正文的 `{"a":1}` 一路切到末尾的 `}`，
    // 拼出两个对象 → JSON.parse 失败 → 整条工具调用丢失。
    const raw = '示例 {"a":1} 然后：```json\n{"tool":"getQuestion","args":{}}\n```';
    expect(extractJsonObject(raw)).toEqual({ tool: 'getQuestion', args: {} });
  });

  it('兼容 JSON 前后夹带多余文字', () => {
    expect(extractJsonObject('好的，我调用：{"tool":"getQuestion","args":{}} 完毕')).toEqual({
      tool: 'getQuestion',
      args: {},
    });
  });

  it('数组、标量、非 JSON 一律返回 null', () => {
    expect(extractJsonObject('[1,2,3]')).toBeNull();
    expect(extractJsonObject('42')).toBeNull();
    expect(extractJsonObject('抱歉，我无法回答。')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
    expect(extractJsonObject('   ')).toBeNull();
  });
});

describe('toolCallName', () => {
  it('支持 {tool,...} 与 {name,...} 两种写法', () => {
    expect(toolCallName({ tool: 'a' })).toBe('a');
    expect(toolCallName({ name: 'b' })).toBe('b');
  });

  it('非字符串或缺失时返回 undefined', () => {
    expect(toolCallName({})).toBeUndefined();
    expect(toolCallName({ tool: 123 })).toBeUndefined();
    expect(toolCallName({ name: null })).toBeUndefined();
  });
});

describe('looksLikeToolCall（展示层拦截判据）', () => {
  it('识别出用户实际遇到的那条', () => {
    expect(looksLikeToolCall('{"tool":"getUserWeaknesses","args":{}}')).toBe(true);
  });

  it('幻觉工具名同样算「像工具调用」——协议内容不分合法与否，都不该给用户看', () => {
    expect(looksLikeToolCall('{"tool":"hackEverything","args":{}}')).toBe(true);
    expect(looksLikeToolCall('{"name":"unknownTool","arguments":{}}')).toBe(true);
  });

  it('代码块包裹与夹带文字也能识别', () => {
    expect(looksLikeToolCall('```json\n{"tool":"getQuestion","args":{}}\n```')).toBe(true);
    expect(looksLikeToolCall('我选择：{"tool":"finishInterview","args":{}}')).toBe(true);
  });

  it('自然语言推理文本不误判', () => {
    expect(looksLikeToolCall('候选人回答了 KV Cache，但没提到显存占用，下一题追问这个角度。')).toBe(false);
    expect(looksLikeToolCall('{"score": 80, "comment": "不错"}')).toBe(false);
    expect(looksLikeToolCall('')).toBe(false);
  });
});
