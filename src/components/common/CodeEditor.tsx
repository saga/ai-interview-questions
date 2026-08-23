import { Editor, DiffEditor, loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import * as monaco from 'monaco-editor';
// monaco-editor 0.56 的 exports map 对深层导入解析有误（node 直接 ERR_MODULE_NOT_FOUND），
// 因此用相对路径绕过包解析；worker 经 Vite ?worker 打包。
import editorWorker from '../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker';
import jsonWorker from '../../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker';
import tsWorker from '../../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';

// 本地打包 monaco（不依赖 CDN）；python 等语言只需基础 editor worker。
let configured = false;
function configureMonaco() {
  if (configured) return;
  configured = true;
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === 'json') return new jsonWorker();
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
      return new editorWorker();
    },
  };
  loader.config({ monaco });
}

const SUPPORTED = new Set(['python', 'javascript', 'typescript', 'sql', 'json']);

function toMonacoLang(language?: string): string {
  return language && SUPPORTED.has(language) ? language : 'plaintext';
}

const BASE_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  lineNumbers: 'on',
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 4,
  fixedOverflowWidgets: true,
};

interface Props {
  value: string;
  onChange: (v: string) => void;
  language?: string;
  height?: number;
}

/** 编程题作答编辑器（可写）。只读展示请用 CodeBlock。 */
export default function CodeEditor({ value, onChange, language, height = 320 }: Props) {
  configureMonaco();
  return (
    <div style={{ border: '1px solid #d9d9d9', borderRadius: 8, overflow: 'hidden' }}>
      <Editor
        height={height}
        theme="vs"
        language={toMonacoLang(language)}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        options={BASE_OPTIONS}
      />
    </div>
  );
}

interface DiffProps {
  original: string;
  modified: string;
  language?: string;
  height?: number;
}

/** 只读对比视图：original=参考答案，modified=用户代码。 */
export function CodeDiff({ original, modified, language, height = 360 }: DiffProps) {
  configureMonaco();
  return (
    <div style={{ border: '1px solid #d9d9d9', borderRadius: 8, overflow: 'hidden' }}>
      <DiffEditor
        height={height}
        theme="vs"
        language={toMonacoLang(language)}
        original={original}
        modified={modified}
        options={{ ...BASE_OPTIONS, readOnly: true, renderSideBySide: true }}
      />
    </div>
  );
}
