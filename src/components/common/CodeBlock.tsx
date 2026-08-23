import { useEffect, useState } from 'react';
import { createHighlighter, type Highlighter } from 'shiki';

/** 按需加载的共享 highlighter（单例），只注册项目实际用到的语言与主题。 */
const LANGS = ['python', 'javascript', 'typescript', 'sql', 'json', 'bash'];
const THEME = 'github-light';

let highlighterPromise: Promise<Highlighter> | null = null;

function loadHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({ themes: [THEME], langs: LANGS });
  return highlighterPromise;
}

const SUPPORTED = new Set<string>(LANGS);

interface Props {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
}

/** 只读代码块：Shiki 语法高亮 + CSS 行号。可编辑场景用 CodeEditor（Monaco）。 */
export default function CodeBlock({ code, language, showLineNumbers = true }: Props) {
  const [html, setHtml] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadHighlighter().then((h) => {
      if (cancelled) return;
      const lang = language && SUPPORTED.has(language) ? language : 'text';
      setHtml(h.codeToHtml(code, { lang, theme: THEME }));
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <div
      className={`code-block${showLineNumbers ? ' code-block-line-numbers' : ''}`}
      dangerouslySetInnerHTML={{ __html: html || `<pre><code>${escapeHtml(code)}</code></pre>` }}
    />
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
