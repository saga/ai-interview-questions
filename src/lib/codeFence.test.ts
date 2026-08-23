import { describe, expect, it } from 'vitest';
import { splitCodeFences } from './codeFence';

describe('splitCodeFences', () => {
  it('无围栏时返回单个文本段', () => {
    expect(splitCodeFences('普通说明文字')).toEqual([{ kind: 'text', content: '普通说明文字' }]);
  });

  it('空输入返回空数组', () => {
    expect(splitCodeFences('')).toEqual([]);
    expect(splitCodeFences('\n\n  \n')).toEqual([]);
  });

  it('解析带语言标注的代码块', () => {
    const segs = splitCodeFences('前文\n```python\ndef f():\n    return 1\n```\n后文');
    expect(segs).toEqual([
      { kind: 'text', content: '前文' },
      { kind: 'code', content: 'def f():\n    return 1', language: 'python' },
      { kind: 'text', content: '后文' },
    ]);
  });

  it('语言标注可省略', () => {
    const segs = splitCodeFences('```\nplain code\n```');
    expect(segs).toEqual([{ kind: 'code', content: 'plain code', language: undefined }]);
  });

  it('支持多个交错代码块并保留顺序', () => {
    const segs = splitCodeFences('a\n```js\nx=1\n```\nb\n```sql\nSELECT 1\n```\nc');
    expect(segs.map((s) => s.kind)).toEqual(['text', 'code', 'text', 'code', 'text']);
    expect(segs[1]).toEqual({ kind: 'code', content: 'x=1', language: 'js' });
    expect(segs[3]).toEqual({ kind: 'code', content: 'SELECT 1', language: 'sql' });
  });

  it('未闭合围栏容错：剩余内容视为代码（LLM 残缺输出）', () => {
    const segs = splitCodeFences('看这段：\n```python\nprint(1)');
    expect(segs).toEqual([
      { kind: 'text', content: '看这段：' },
      { kind: 'code', content: 'print(1)', language: 'python' },
    ]);
  });

  it('代码块内部的 ``` 缩进行不会误判为结束符', () => {
    const segs = splitCodeFences('```text\n  ```nested```\n```');
    expect(segs).toEqual([
      { kind: 'code', content: '  ```nested```', language: 'text' },
    ]);
  });

  it('丢弃空白文本段但保留空白代码行', () => {
    const segs = splitCodeFences('\n\n文字\n\n```py\n\nx = 1\n\n```');
    expect(segs).toHaveLength(2);
    expect(segs[0].kind).toBe('text');
    expect(segs[1]).toEqual({ kind: 'code', content: '\nx = 1\n', language: 'py' });
  });
});
