// extractJSON 兜底路径：模型常在 JSON 前后夹解释文字，尾部文字里也可能出现方括号。
// 旧实现取「最后一个 } 或 ]」，会把合法 JSON 截短；这里锁定按括号配对恢复的行为。

import { describe, expect, it } from 'vitest';
import { extractJSON } from './pi';

describe('extractJSON', () => {
  it('纯 JSON 与代码块照常解析', () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
    expect(extractJSON('```json\n["x", "y"]\n```')).toEqual(['x', 'y']);
  });

  it('尾部说明文字中的 ] 不会截断合法对象', () => {
    const raw = '结果如下：{"a":[1,2],"b":{"c":3}} 说明见 [附录]';
    expect(extractJSON(raw)).toEqual({ a: [1, 2], b: { c: 3 } });
  });

  it('字符串内部的括号和转义引号不参与配对', () => {
    const raw = '前缀 {"text":"] not closing { and \\"quoted\\"","n":1} 尾注 }';
    expect(extractJSON(raw)).toEqual({ text: '] not closing { and "quoted"', n: 1 });
  });

  it('找不到 JSON 时抛出可读错误', () => {
    expect(() => extractJSON('这里没有 JSON，只有 [一些] 文字')).toThrow('LLM 未返回可解析的 JSON');
  });
});
