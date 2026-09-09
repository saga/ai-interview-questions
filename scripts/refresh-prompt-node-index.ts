#!/usr/bin/env node --experimental-strip-types
/**
 * 把本仓库的知识节点（src/data/knowledge/*.json）生成「紧凑 ID 索引」，
 * 并固化进 docs/prompt_part1.md 的 [EMBEDDED_KNOWLEDGE_NODES] 标记之间。
 *
 * 设计意图（对应 prompt1 v7 → 的 Node Contract 重做）：
 *   - 不再使用运行时占位符 [AVAILABLE_KNOWLEDGE_NODES]（手动 Gemini 流程下必然硬失败）；
 *   - 改为「由仓库生成、随 Prompt 固化」的 Embedded Knowledge Node Index；
 *   - Gemini 直接从这个内嵌索引里选合法 topic，不再等待外部注入；
 *   - 新增节点后重跑本脚本即可刷新索引，避免漂移。
 *
 * 用法：
 *   npm run refresh:node-index
 *   node scripts/refresh-prompt-node-index.ts
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KNOWLEDGE_DIR = join(process.cwd(), 'src/data/knowledge');
const PROMPT_FILE = join(process.cwd(), 'docs/prompt_part1.md');
const OPEN = '[EMBEDDED_KNOWLEDGE_NODES]';
const CLOSE = '[/EMBEDDED_KNOWLEDGE_NODES]';

interface KnowledgeNode {
  id: string;
  name?: string;
}

function loadNodes(): KnowledgeNode[] {
  const files = readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.json'));
  const nodes: KnowledgeNode[] = [];
  for (const f of files) {
    try {
      const arr = JSON.parse(readFileSync(join(KNOWLEDGE_DIR, f), 'utf8')) as KnowledgeNode[];
      if (Array.isArray(arr)) nodes.push(...arr);
    } catch {
      // 跳过无法解析的文件
    }
  }
  return nodes;
}

function main(): void {
  const nodes = loadNodes();
  if (nodes.length === 0) {
    console.error('no knowledge nodes found');
    process.exit(1);
  }

  const lines = nodes
    .filter((n) => n.id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => `${n.id} | ${n.name ?? ''}`);

  const prompt = readFileSync(PROMPT_FILE, 'utf8');
  if (!prompt.includes(OPEN) || !prompt.includes(CLOSE)) {
    console.error(`prompt file missing ${OPEN} / ${CLOSE} markers`);
    process.exit(1);
  }

  const block = `${OPEN}\n${lines.join('\n')}\n${CLOSE}`;
  const pattern = `\\[EMBEDDED_KNOWLEDGE_NODES\\][\\s\\S]*?\\[/EMBEDDED_KNOWLEDGE_NODES\\]`;
  const next = prompt.replace(new RegExp(pattern), block);

  if (next === prompt) {
    console.error('embedded block was not replaced (unexpected)');
    process.exit(1);
  }

  writeFileSync(PROMPT_FILE, next, 'utf8');
  console.error(`refreshed ${lines.length} node ids into ${PROMPT_FILE}`);
}

main();
