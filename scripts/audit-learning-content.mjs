#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
  ['generic-data-engineering-intro', /数据工程。将输入、摄取、转换、状态推进、目标写入和下游可见性分开观察/],
  ['generic-ai-governance-intro', /Cortex Agents、ML 与 CoCo。明确目标、工具\/模型边界、身份授权、输入输出、执行证据、评测和停止条件/],
  ['generic-scene-wrapper', /将场景转换为明确输入、状态变化和预期输出/],
  ['generic-context-wrapper', /落实时将这项要求放到实际输入、输出和运行上下文里验证/],
  ['generic-checklist-wrapper', /确认对象类型、当前 Role、Warehouse、Database 和 Schema/],
  ['generic-workload-wrapper', /用相同输入与代表性工作负载验证结果，并记录权限、成本和失败恢复影响/],
  ['generic-warehouse-scenario', /分析团队发现同一张表在不同 Warehouse 上表现不同/],
  ['generic-answer-meta', /回答时需要给出判断依据和验证方法，而不只是复述定义/],
  ['generic-topic-meta', /本教程只对应知识点[^。]{0,100}不把相邻知识点合并成一个大章/],
  ['generic-business-metric-copy', /业务指标必须定义分子、分母、过滤条件、时间口径、事实粒度和可加性。语义层能表达已确认的业务定义，却不能修复底层错误键、粒度或多对多关系/],
  ['generic-generic-test-question', /如何在实际系统中验证[“「][^”」]+[”」]/],
  ['generic-generic-failure-question', /当[“「][^”」]+[”」]不成立时，最可能需要检查哪些边界和证据/],
  ['generic-generic-correction', /回到本知识点的输入条件、执行边界和验证证据，确认判断成立的前提/],
  ['generic-generic-misconception', /认为.+完全相同[\s\S]{0,120}业务指标必须定义分子、分母/],
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
    .filter((part) => part.length >= 60)
    .map((raw) => ({ raw, normalized: normalize(raw) }))
    .filter((part) => part.normalized.length >= 60);
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
  article: [],
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
    console.error(`无法计算教程变更文件（base=${base}）：${error instanceof Error ? error.message : String(error)}`);
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
const reviewNotes = [];
const articleManifestChanged = !strict || changed.has('src/content/courses/snowflake/index.json');
const integratedManifestChanged = !strict || changed.has('src/content/courses/snowflake/integrated/index.json');
if (articleManifestChanged && manifest.nodes.length !== 194) {
  structureProblems.push({ id: 'snowflake-course', path: 'src/content/courses/snowflake/index.json', problem: `KnowledgeNode 数量应为 194，实际为 ${manifest.nodes.length}` });
}
if (integratedManifestChanged && integratedManifest.tutorials.length !== 8) {
  structureProblems.push({ id: 'snowflake-integrated-course', path: 'src/content/courses/snowflake/integrated/index.json', problem: `综合教程数量应为 8，实际为 ${integratedManifest.tutorials.length}` });
}
const mappedFiles = new Set(manifest.nodes.map((entry) => entry.file));
const mappedIntegratedFiles = new Set(integratedManifest.tutorials.map((entry) => entry.file));
for (const file of readdirSync(resolve(root, articleRoot)).filter((name) => name.endsWith('.md'))) {
  const filePath = articleRoot + file;
  if (!mappedFiles.has(file) && (!strict || changed.has(filePath))) {
    structureProblems.push({ id: file, path: filePath, problem: '文章文件未映射到任何 KnowledgeNode' });
  }
}
for (const file of readdirSync(resolve(root, integratedRoot)).filter((name) => name.endsWith('.md'))) {
  const filePath = integratedRoot + file;
  if (!mappedIntegratedFiles.has(file) && (!strict || changed.has(filePath))) {
    structureProblems.push({ id: file, path: filePath, problem: '综合教程文件未映射到 integrated manifest' });
  }
}
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
  const headingsToIndex = doc.kind === 'article'
    ? [...doc.sections.keys()]
    : required[doc.kind];
  for (const heading of headingsToIndex) {
    const sectionContent = doc.sections.get(heading) ?? '';
    if (isTarget && doc.kind === 'integrated' && (!sectionContent.trim())) {
      structureProblems.push({ id: doc.id, path: doc.path, problem: `缺少内容章节：${heading}` });
    }
    for (const paragraph of paragraphs(sectionContent)) {
      const key = `${doc.kind}::${heading}::${paragraph.normalized}`;
      const group = paragraphIndex.get(key) ?? { kind: doc.kind, heading, paragraph: paragraph.raw, ids: [] };
      group.ids.push(doc.id);
      paragraphIndex.set(key, group);
    }
  }
  if (doc.refs.some((reference) => reference.verifiedAt === '待核验')) pendingSources.push(doc.id);
  if (!doc.refs.length) sourceMissing.push(doc.id);

  if (isTarget && doc.kind === 'article') {
    const sectionText = [...doc.sections.values()].join('\n');
    const problem = doc.sections.get('本节要解决的问题') ?? '';
    const core = doc.sections.get('核心知识') ?? '';
    const scenario = doc.sections.get('场景分析') ?? '';
    const tests = doc.sections.get('自测') ?? '';
    const scenarioHasPlaceholder = /将场景转换为明确输入|逐项检查本节核心要求|请拆分对象、执行和访问边界/.test(scenario);
    const testsHaveTemplate = /如何在实际系统中验证|不成立时，最可能需要检查哪些边界和证据|回答时需要给出判断依据/.test(tests);
    const genericReference = doc.refs.some((reference) =>
      /核对.+涉及的产品行为、配置边界和工程机制|用于核对本综合教程涉及的产品行为、配置边界和工程机制|用于核对本教程涉及的产品行为、配置边界和工程机制/.test(reference.relevance ?? ''),
    );
    const codeBlockCount = countMatches(doc.markdown, /~~~[a-z0-9_-]*\s+[\s\S]*?~~~/gi);
    const tableRowCount = countMatches(doc.markdown, /^\|.*\|$/gm);
    const hasInspectableExample = codeBlockCount > 0 || tableRowCount >= 3
      || /例如|假设|样例|一笔订单|一条记录|输入为|输出为|案例/.test(sectionText);
    const visibleText = sectionText
      .replace(/~~~[\s\S]*?~~~/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .trim();
    const checks = [
      [visibleText.length > 0, '文章没有可读的实质正文'],
      [!problem.trim() || !/围绕 Snowflake 的.+掌握.+在真实数据源、结构化分析、非结构化证据和生产治理方面的应用/.test(problem), '问题定义仍是课程元说明，没有具体读者问题'],
      [!scenario.trim() || !scenarioHasPlaceholder, '场景分析仍是模板句式'],
      [!tests.trim() || !testsHaveTemplate, '自测仍是模板句式'],
      [doc.refs.length >= 1 && doc.refs.every((reference) => reference.verifiedAt !== '待核验'), '缺少已核验来源引用'],
      [!genericReference, '参考资料说明仍是通用模板，未说明与本篇的具体关系'],
    ];
    for (const [passed, message] of checks) {
      if (!passed) qualityProblems.push({ id: doc.id, path: doc.path, problem: message });
    }
    if (!hasInspectableExample) {
      reviewNotes.push({ id: doc.id, path: doc.path, problem: '未检测到可复核实例；请人工确认文章是否通过具体机制、反例或决策推演支撑结论。代码和表格不是必需形式。' });
    }
    for (const [name, pattern] of boilerplatePatterns) {
      if (pattern.test(doc.markdown)) qualityProblems.push({ id: doc.id, path: doc.path, problem: '模板残留：' + name });
    }
  }

  if (isTarget && doc.kind === 'integrated') {
    const visibleText = (text) => text
      .replace(/~~~[\s\S]*?~~~/g, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .trim();
    const scene = visibleText(doc.sections.get('场景与目标') ?? '');
    const steps = visibleText(doc.sections.get('实施步骤') ?? '');
    const tradeoffs = visibleText(doc.sections.get('关键取舍') ?? '');
    const acceptance = visibleText(doc.sections.get('验收清单') ?? '');
    const linked = doc.sections.get('关联知识点') ?? '';
    const references = doc.sections.get('参考资料') ?? '';
    const mermaidBlocks = [...doc.markdown.matchAll(/~~~mermaid\s*([\s\S]*?)~~~/gi)]
      .map((match) => match[1]);
    const diagramSource = mermaidBlocks.join('\n');
    const hasArchitectureDiagram =
      /\b(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/i.test(diagramSource)
      && countMatches(diagramSource, /-->|-.->|==>|---/g) >= 6;
    const stepCount = countMatches(steps, /^\s*\d+[.)]\s+/gm);
    const tradeoffCount = countMatches(tradeoffs, /^\s*[-*+]\s+/gm);
    const acceptanceCount = countMatches(acceptance, /^\s*(?:[-*+]\s+|\[[ xX]\]\s+)/gm);
    const linkedArticleCount = countMatches(linked, /\]\([^)]*articles\/[^)]+\.md\)/g);
    const referenceLinkCount = countMatches(references, /\]\(https?:\/\//g);
    const matchedReferenceCount = doc.refs.filter((reference) =>
      reference.url && doc.markdown.includes(reference.url),
    ).length;
    const checks = [
      [scene.length >= 70, '场景目标描述不足（' + scene.length + ' 字符）'],
      [hasArchitectureDiagram, '缺少可读的架构流程图（' + mermaidBlocks.length + ' 个 Mermaid 图，边数不足或类型不符）'],
      [steps.length >= 400 && stepCount >= 5, '实施步骤不足（' + steps.length + ' 字符，' + stepCount + ' 项）'],
      [tradeoffs.length >= 120 && tradeoffCount >= 3, '关键取舍不足（' + tradeoffs.length + ' 字符，' + tradeoffCount + ' 项）'],
      [acceptance.length >= 100 && acceptanceCount >= 4, '验收条件不足（' + acceptance.length + ' 字符，' + acceptanceCount + ' 项）'],
      [linkedArticleCount >= 3, '关联节点教程链接不足（' + linkedArticleCount + ' 个）'],
      [
        doc.refs.length >= 2 && referenceLinkCount >= 2 && matchedReferenceCount >= 2,
        '参考资料不足或未与来源清单对应（正文 ' + referenceLinkCount + ' 个链接，元数据 ' + doc.refs.length + ' 条，匹配 ' + matchedReferenceCount + ' 条）',
      ],
    ];
    for (const [passed, message] of checks) {
      if (!passed) qualityProblems.push({ id: doc.id, path: doc.path, problem: message });
    }
  }
}
const duplicates = [...paragraphIndex.values()]
  .filter((group) => group.ids.length > 1)
  .filter((group) => !strict || group.ids.some((id) => changedIds.has(id)))
  .map((group) => ({
    ...group,
    ids: [...new Set(group.ids)],
    repeatedWithinArticle: new Set(group.ids).size < group.ids.length,
    occurrences: group.ids.length,
  }))
  .sort((a, b) => b.ids.length - a.ids.length || a.heading.localeCompare(b.heading));

console.log('学习内容审计：' + targets.length + ' 篇教程；' + duplicates.length
  + ' 组重复段落（含同篇复用）；' + structureProblems.length + ' 处结构问题；'
  + qualityProblems.length + ' 处质量问题；' + reviewNotes.length + ' 条内容复核提示；'
  + pendingSources.length + ' 篇含待核验来源；' + sourceMissing.length + ' 篇缺少来源元数据。');
for (const item of duplicates.slice(0, 20)) {
  console.log(`  ${item.repeatedWithinArticle ? '同篇重复' : '跨篇重复'} [${item.kind} / ${item.heading}] · ${item.ids.length} 篇 / ${item.occurrences} 次：${item.ids.slice(0, 8).join(', ')}`);
  console.log(`    ${item.paragraph.replace(/\n/g, ' ').slice(0, 180)}`);
}
for (const item of structureProblems.slice(0, 30)) {
  console.log(`  内容结构 [${item.id}]：${item.problem}`);
}
for (const item of reviewNotes.slice(0, 30)) {
  console.log(`  内容复核 [${item.id}]：${item.problem}`);
}
for (const item of qualityProblems.slice(0, 50)) {
  console.log(`  内容质量 [${item.id}]：${item.problem}`);
}
if (pendingSources.length) {
  console.log(`  来源待复核：${pendingSources.slice(0, 16).join(', ')}${pendingSources.length > 16 ? ' …' : ''}`);
}
if (sourceMissing.length) {
  console.log(`  来源元数据缺失：${sourceMissing.slice(0, 16).join(', ')}${sourceMissing.length > 16 ? ' …' : ''}`);
}
if (strict && (duplicates.length > 0 || structureProblems.length > 0 || qualityProblems.length > 0)) {
  console.error('学习内容质量门禁失败：变更教程存在重复、结构缺失、内容薄弱或模板残留。');
  process.exit(1);
}
