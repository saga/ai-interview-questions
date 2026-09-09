#!/usr/bin/env node --experimental-strip-types
/**
 * 把本仓库的知识节点导出为可直接粘贴进 prompt_part1.md 的
 * `[AVAILABLE_KNOWLEDGE_NODES]` 占位符的文本。
 *
 * 手动（Gemini in Chrome）工作流：
 *   1. 运行 `npm run dump:nodes -- --area llm`（或省略 --area 导出全部）
 *   2. 复制输出
 *   3. 在 prompt_part1.md 中**整行删除** `[AVAILABLE_KNOWLEDGE_NODES]`，
 *      把复制的文本粘贴到那个位置
 *   4. 再把这个 prompt 全文 + 当前网页交给 Gemini
 *
 * 为什么需要这步：prompt1 v7 §0 对“占位符未被替换”做硬失败
 * （输出 {"error":"AVAILABLE_KNOWLEDGE_NODES not provided"}）。
 * 手动流程没有自动注入方，必须人工把节点清单填进去，否则必然硬失败。
 *
 * 用法：
 *   node scripts/dump-knowledge-nodes.ts [--area <area>] [--write <file>] [--count]
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KNOWLEDGE_DIR = join(process.cwd(), 'src/data/knowledge');

function parseArgs(argv: string[]): { area?: string; write?: string; count: boolean } {
  const out: { area?: string; write?: string; count: boolean } = { count: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--area') out.area = argv[++i];
    else if (a === '--write') out.write = argv[++i];
    else if (a === '--count') out.count = true;
  }
  return out;
}

interface KnowledgeNode {
  id: string;
  name?: string;
  area?: string;
  topic?: string;
  summary?: string;
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

function formatNode(n: KnowledgeNode): string {
  const lines = [`- id: ${n.id}`];
  if (n.name) lines.push(`  name: ${n.name}`);
  if (n.area) lines.push(`  area: ${n.area}`);
  if (n.topic) lines.push(`  topic: ${n.topic}`);
  if (n.summary) lines.push(`  summary: ${n.summary}`);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let nodes = loadNodes();
  const total = nodes.length;
  if (args.area) nodes = nodes.filter((n) => n.area === args.area);

  if (args.count) {
    const byArea: Record<string, number> = {};
    for (const n of loadNodes()) byArea[n.area ?? '?'] = (byArea[n.area ?? '?'] ?? 0) + 1;
    console.error(`total nodes: ${total}`);
    console.error(`areas: ${JSON.stringify(byArea)}`);
    console.error(`after --area ${args.area ?? '(none)'}: ${nodes.length}`);
    return;
  }

  const header = args.area
    ? `# Knowledge nodes (area=${args.area}, ${nodes.length}/${total})\n`
    : `# Knowledge nodes (all, ${nodes.length})\n`;
  const body = nodes.map(formatNode).join('\n');
  const text = `${header}${body}\n`;

  if (args.write) {
    writeFileSync(args.write, text, 'utf8');
    console.error(`wrote ${nodes.length} nodes to ${args.write}`);
  }
  // 主输出到 stdout，便于直接复制
  process.stdout.write(text);
}

main();
