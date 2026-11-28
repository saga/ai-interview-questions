#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const articleRoot = 'src/content/courses/snowflake/articles/';
const integratedRoot = 'src/content/courses/snowflake/integrated/';
const manifestPath = resolve(root, 'src/content/courses/snowflake/index.json');
const integratedManifestPath = resolve(root, 'src/content/courses/snowflake/integrated/index.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const integratedManifest = JSON.parse(readFileSync(integratedManifestPath, 'utf8'));
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const baseIndex = args.indexOf('--base');
const base = baseIndex >= 0 ? args[baseIndex + 1] : undefined;

function normalize(text) {
  return text
    .normalize('NFKC')
    .replace(/\r/g, '')
    .replace(/`{3}[\s\S]*?`{3}/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/\|[^\n]*\|/g, ' ')
    .replace(/[#>*_~\-\s]+/g, ' ')
    .replace(/[，。；、,.!:：？?（）()\[\]{}"'“”‘’]/g, '')
    .trim()
    .toLocaleLowerCase();
}
function sections(markdown) {
  const result = new Map();
  let current = null;
  const lines = markdown.split('\n');
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].trim();
      result.set(current, []);
    } else if (current) {
      result.get(current).push(line);
    }
  }
  return new Map([...result].map(([key, lines]) => [key, lines.join('\n').trim()]));
}
function paragraphs(text) {
  return text.split(/\n\s*\n/)
    .map((part) => part.replace(/^\s*(?:[-*+] |\d+[.)] )/gm, '').trim())
    .filter((part) => part.length >= 100)
    .map((raw) => ({ raw, normalized: normalize(raw) }))
    .filter((part) => part.normalized.length >= 100);
}
function loadEntry(entry, baseDir) {
  const path = baseDir + entry.file;
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return { id: entry.id, path, missing: true, sections: new Map(), refs: [] };
  const markdown = readFileSync(absolute, 'utf8');
  return { id: entry.id, path, markdown, missing: false, sections: sections(markdown), refs: entry.references ?? [] };
}

const docs = [
  ...manifest.nodes.map((entry) => ({ ...loadEntry(entry, articleRoot), kind: 'article' })),
  ...integratedManifest.tutorials.map((entry) => ({ ...loadEntry(entry, integratedRoot), kind: 'integrated' })),
];
const required = {
  article: ['本节要解决的问题', '核心知识', '工程实施步骤', '场景分析', '常见误区', '完成标准', '自测'],
  integrated: ['场景与目标', '架构与数据流', '实施步骤', '关键取舍', '验收清单', '关联知识点', '参考资料'],
};
let changed = null;
if (strict) {
  if (!base) {
    console.error('严格模式必须提供 --base <git-ref>。');
    process.exit(2);
  }
  try {
    changed = new Set(execFileSync('git', [
      'diff', '--name-only', '--diff-filter=ACMRT', `${base}...HEAD`,
    ], { encoding: 'utf8' }).split('\n').filter(Boolean));
  } catch (error) {
    console.error(`无法计算教程变更文件（base=${base}）：${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
const targets = changed
  ? docs.filter((doc) => changed.has(doc.path))
  : docs;
if (changed && targets.length === 0) {
  console.log('学习内容审计：本次变更没有课程教程文件，跳过增量门禁。');
  process.exit(0);
}

const missing = [];
const paragraphIndex = new Map();
const changedIds = new Set(targets.map((doc) => doc.id));
const pendingSources = [];
for (const doc of docs) {
  if (doc.missing) {
    missing.push({ id: doc.id, path: doc.path, problem: '文件不存在' });
    continue;
  }
  for (const heading of required[doc.kind]) {
    if (!doc.sections.has(heading) || !doc.sections.get(heading)) {
      missing.push({ id: doc.id, path: doc.path, problem: `缺少内容章节：${heading}` });
    }
    for (const paragraph of paragraphs(doc.sections.get(heading) ?? '')) {
      const key = `${doc.kind}::${heading}::${paragraph.normalized}`;
      const group = paragraphIndex.get(key) ?? { kind: doc.kind, heading, paragraph: paragraph.raw, ids: [] };
      group.ids.push(doc.id);
      paragraphIndex.set(key, group);
    }
  }
  if (doc.refs.some((reference) => reference.verifiedAt === '待核验')) pendingSources.push(doc.id);
}
const duplicates = [...paragraphIndex.values()]
  .filter((group) => new Set(group.ids).size > 1)
  .filter((group) => !strict || group.ids.some((id) => changedIds.has(id)))
  .map((group) => ({ ...group, ids: [...new Set(group.ids)] }))
  .sort((a, b) => b.ids.length - a.ids.length || a.heading.localeCompare(b.heading));

console.log(`学习内容审计：${targets.length} 篇教程；${duplicates.length} 组跨文档重复段落；${missing.length} 处结构问题；${pendingSources.length} 篇含待核验来源。`);
for (const item of duplicates.slice(0, 20)) {
  console.log(`  重复段落 [${item.kind} / ${item.heading}] · ${item.ids.length} 篇：${item.ids.slice(0, 8).join(', ')}`);
  console.log(`    ${item.paragraph.replace(/\n/g, ' ').slice(0, 180)}`);
}
for (const item of missing.slice(0, 30)) {
  console.log(`  内容结构 [${item.id}]：${item.problem}`);
}
if (pendingSources.length) {
  console.log(`  来源待复核：${pendingSources.slice(0, 16).join(', ')}${pendingSources.length > 16 ? ' …' : ''}`);
}
if (strict && (duplicates.length > 0 || missing.length > 0)) {
  console.error('学习内容质量门禁失败：新增或修改的教程存在跨文档重复段落或缺少必要章节。');
  process.exit(1);
}
