// 纯逻辑：把含 ``` 围栏代码块的文本切分为文本段与代码段。不依赖 React。

export type TextSegment =
  | { kind: 'text'; content: string }
  | { kind: 'code'; content: string; language?: string };

/**
 * 按 GitHub 风格围栏（```lang ... ```）切分文本。
 * - 未闭合的围栏：剩余内容视为代码段（容错 LLM 输出残缺）。
 * - 空白段被丢弃。
 */
export function splitCodeFences(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let textLines: string[] = [];
  let codeLines: string[] | null = null;
  let language: string | undefined;

  const flushText = () => {
    if (textLines.length > 0) segments.push({ kind: 'text', content: textLines.join('\n') });
    textLines = [];
  };
  const flushCode = () => {
    if (codeLines !== null) {
      segments.push({ kind: 'code', content: codeLines.join('\n'), language });
      codeLines = null;
      language = undefined;
    }
  };

  for (const line of text.split('\n')) {
    if (codeLines === null && line.trimStart().startsWith('```')) {
      flushText();
      codeLines = [];
      language = line.trim().slice(3).trim() || undefined;
    } else if (codeLines !== null && line.trim() === '```') {
      flushCode();
    } else if (codeLines !== null) {
      codeLines.push(line);
    } else {
      textLines.push(line);
    }
  }
  flushCode();
  flushText();

  return segments.filter((s) => s.content.trim().length > 0);
}
