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

const boilerplatePatterns = [
  ['generic-platform-boundary', /Snowflake 的存储、计算与 Cloud Services 属于不同责任边界/],
  ['generic-snowflake-introduction', /Snowflake 平台基础。区分持久化对象、计算资源、元数据服务、会话上下文和授权主体/],
  ['generic-scenario-wrapper', /将场景转换为明确输入、状态变化和预期输出/],
  ['generic-context-wrapper', /落实时将这项要求放到实际输入、输出和运行上下文里验证/],
  ['generic-object-checklist', /确认对象类型、当前 Role、Warehouse、Database 和 Schema/],
  ['generic-workload-wrapper', /用相同输入与代表性工作负载验证结果，并记录权限、成本和失败恢复影响/],
  ['generic-warehouse-scenario', /分析团队发现同一张表在不同 Warehouse 上表现不同/],
  ['generic-test-placeholder', /回答时需要给出判断依据和验证方法，而不只是复述定义/],
  ['generic-data-engineering-intro', /数据工程。将输入、摄取、转换、状态推进、目标写入和下游可见性分开观察/],
  ['generic-observability-wrapper', /日志解释发生了什么，指标观察趋势，Trace 关联跨步骤执行/],
];

function normalize(text) {
  return text
    .normalize('NFKC')
    .replace(/\x60{3}[\s\S]*?\x60{3}/g, ' ')
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
  for (const line of markdown.split('\n')) {
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
function countMatches(text, regex) {
  return [...text.matchAll(regex)].length;
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
      'diff', '--name-only', '--diff-filter=ACMRT', base + '...HEAD',
    ], { encoding: 'utf8' }).split('\n').filter(Boolean));
  } catch (error) {
    console.error(\`无法计算教程变更文件（base=\${base}）：\${error instanceof Error ? error.message : String(error)}\`);
    process.exit(2);
  }
}
const targets = changed ? docs.filter((doc) => changed.has(doc.path)) : docs;
if (changed && targets.length === 0) {
  console.log('学习内容审计：本次变更没有课程教程文件，跳过增量门禁。');
  process.exit(0);
}

const structureProblems = [];
const qualityProblems = [];
const paragraphIndex = new Map();
const changedIds = new Set(targets.map((doc) => doc.id));
const pendingSources = [];
const sourceMissing = [];
for (const doc of docs) {
  const isTarget = !strict || changedIds.has(doc.id);
  if (doc.missing) {
    if (isTarget) structureProblems.push({ id: doc.id, path: doc.path, problem: '文件不存在' });
    continue;
  }
  for (const heading of required[doc.kind]) {
    if (isTarget && (!doc.sections.has(heading) || !doc.sections.get(heading))) {
      structureProblems.push({ id: doc.id, path: doc.path, problem: \`缺少内容章节：\${heading}\` });
    }
    for (const paragraph of paragraphs(doc.sections.get(heading) ?? '')) {
      const key = \`\${doc.kind}::\${heading}::\${paragraph.normalized}\`;
      const group = paragraphIndex.get(key) ?? { kind: doc.kind, heading, paragraph: paragraph.raw, ids: [] };
      group.ids.push(doc.id);
      paragraphIndex.set(key, group);
    }
  }
  if (doc.refs.some((reference) => reference.verifiedAt === '待核验')) pendingSources.push(doc.id);
  if (!doc.refs.length) sourceMissing.push(doc.id);

  if (isTarget && doc.kind === 'article') {
    const problem = doc.sections.get('本节要解决的问题') ?? '';
    const core = doc.sections.get('核心知识') ?? '';
    const steps = doc.sections.get('工程实施步骤') ?? '';
    const scenario = doc.sections.get('场景分析') ?? '';
    const misconceptions = doc.sections.get('常见误区') ?? '';
    const tests = doc.sections.get('自测') ?? '';
    const h3Count = countMatches(core, /^###\s+/gm);
    const stepCount = countMatches(steps, /^\s*\d+[.)]\s+/gm);
    const misconceptionCount = countMatches(misconceptions, /^\s*[-*+]\s+/gm);
    const testCount = countMatches(tests, /^\s*\d+[.)]\s+/gm);
    const checks = [
      [problem.length >= 70, '问题定义少于 70 字符'],
      [core.length >= 450 && h3Count >= 2, \`核心机制不足（\${core.length} 字符，\${h3Count} 个小节）\`],
      [steps.length >= 260 && stepCount >= 3, \`实施步骤不足（\${steps.length} 字符，\${stepCount} 项）\`],
      [scenario.length >= 220, \`场景分析不足（\${scenario.length} 字符）\`],
      [misconceptionCount >= 2, \`常见误区不足（\${misconceptionCount} 项）\`],
      [testCount >= 3, \`自测题不足（\${testCount} 题）\`],
      [doc.refs.length >= 1 && doc.refs.every((reference) => reference.verifiedAt !== '待核验'), '缺少已核验来源引用'],
    ];
    for (const [passed, message] of checks) {
      if (!passed) qualityProblems.push({ id: doc.id, path: doc.path, problem: message });
    }
    for (const [name, pattern] of boilerplatePatterns) {
      if (pattern.test(doc.markdown)) qualityProblems.push({ id: doc.id, path: doc.path, problem: \`模板残留：\${name}\` });
    }
  }
}
const duplicates = [...paragraphIndex.values()]
  .filter((group) => new Set(group.ids).size > 1)
  .filter((group) => !strict || group.ids.some((id) => changedIds.has(id)))
  .map((group) => ({ ...group, ids: [...new Set(group.ids)] }))
  .sort((a, b) => b.ids.length - a.ids.length || a.heading.localeCompare(b.heading));

console.log(\`学习内容审计：\${targets.length} 篇教程；\${duplicates.length} 组跨文档重复段落；\${structureProblems.length} 处结构问题；\${qualityProblems.length} 处内容质量问题；\${pendingSources.length} 篇含待核验来源；\${sourceMissing.length} 篇缺少来源元数据。\`);
for (const item of duplicates.slice(0, 20)) {
  console.log(\`  重复段落 [\${item.kind} / \${item.heading}] · \${item.ids.length} 篇：\${item.ids.slice(0, 8).join(', ')}\`);
  console.log(\`    \${item.paragraph.replace(/\n/g, ' ').slice(0, 180)}\`);
}
for (const item of structureProblems.slice(0, 30)) {
  console.log(\`  内容结构 [\${item.id}]：\${item.problem}\`);
}
for (const item of qualityProblems.slice(0, 50)) {
  console.log(\`  内容质量 [\${item.id}]：\${item.problem}\`);
}
if (pendingSources.length) {
  console.log(\`  来源待复核：\${pendingSources.slice(0, 16).join(', ')}\${pendingSources.length > 16 ? ' …' : ''}\`);
}
if (sourceMissing.length) {
  console.log(\`  来源元数据缺失：\${sourceMissing.slice(0, 16).join(', ')}\${sourceMissing.length > 16 ? ' …' : ''}\`);
}
if (strict && (duplicates.length > 0 || structureProblems.length > 0 || qualityProblems.length > 0)) {
  console.error('学习内容质量门禁失败：变更教程存在重复、结构缺失、内容薄弱或模板残留。');
  process.exit(1);
}
