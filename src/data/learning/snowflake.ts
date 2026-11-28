import manifest from '../../content/courses/snowflake/index.json';
import integratedManifest from '../../content/courses/snowflake/integrated/index.json';
import { knowledgeNodes } from '../knowledgeMap';

export type LearningArticleKind = 'core' | 'deep-dive' | 'case-study';
export type LearningArticleLevel = 'foundation' | 'intermediate' | 'advanced';
export type LearningReferenceKind = 'official' | 'paper' | 'standard' | 'engineering' | 'case' | 'book';

export interface LearningArticle {
  id: string;
  nodeId: string;
  title: string;
  kind: LearningArticleKind;
  level: LearningArticleLevel;
  estimatedMinutes: number;
  content: string;
}

export interface LearningReference {
  id: string;
  type: LearningReferenceKind;
  title: string;
  url: string;
  publisher: string;
  relevance: string;
  verifiedAt: string;
}

export interface KnowledgeLearningPack {
  nodeId: string;
  articles: [LearningArticle];
  references: LearningReference[];
}

interface ArticleManifestEntry extends Omit<LearningArticle, 'content'> {
  knowledgeId: string;
  file: string;
  topic: string;
  priority: string;
  summary: string;
  references: LearningReference[];
}

interface LearningManifest {
  schemaVersion: number;
  binding: 'one-article-per-knowledge-node';
  overview: {
    introduction: string;
    audience: string;
    objectives: string[];
    roadmap: string[];
    notes: string;
  };
  nodes: ArticleManifestEntry[];
}

const typedManifest = manifest as LearningManifest;
if (typedManifest.schemaVersion !== 2 || typedManifest.binding !== 'one-article-per-knowledge-node') {
  throw new Error('课程教材索引版本或一对一绑定声明无效');
}

const markdownModules = import.meta.glob('../../content/courses/snowflake/articles/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

export const SNOWFLAKE_LEARNING_OVERVIEW = typedManifest.overview;

const courseNodes = knowledgeNodes.filter((node) =>
  node.courseId === 'snowflake' || (!node.courseId && node.area === 'data-platform'),
);
const nodeById = new Map(courseNodes.map((node) => [node.id, node]));
const manifestByNodeId = new Map(typedManifest.nodes.map((entry) => [entry.knowledgeId, entry]));
if (manifestByNodeId.size !== typedManifest.nodes.length) {
  throw new Error('教材索引存在重复 KnowledgeNode ID');
}
if (manifestByNodeId.size !== courseNodes.length) {
  throw new Error(`教材与知识点数量不一致：articles=${manifestByNodeId.size}, nodes=${courseNodes.length}`);
}

export const SNOWFLAKE_LEARNING_ARTICLES: LearningArticle[] = typedManifest.nodes.map((entry) => {
  if (entry.id !== entry.nodeId || entry.id !== entry.knowledgeId) {
    throw new Error(`教程必须与 KnowledgeNode 一对一绑定：${entry.id}`);
  }
  const node = nodeById.get(entry.knowledgeId);
  if (!node) {
    throw new Error(`教程引用了不存在的 KnowledgeNode：${entry.knowledgeId}`);
  }
  if (entry.title !== node.name || entry.topic !== node.topic) {
    throw new Error(`教程标题或主题与 KnowledgeNode 不一致：${entry.knowledgeId}`);
  }
  const key = `../../content/courses/snowflake/articles/${entry.file}`;
  const content = markdownModules[key];
  if (typeof content !== 'string') {
    throw new Error(`课程文章未找到：${entry.file}`);
  }
  return {
    id: entry.id,
    nodeId: entry.nodeId,
    title: entry.title,
    kind: entry.kind,
    level: entry.level,
    estimatedMinutes: entry.estimatedMinutes,
    content,
  };
});

const articleByNodeId = new Map(SNOWFLAKE_LEARNING_ARTICLES.map((article) => [article.nodeId, article]));
if (articleByNodeId.size !== SNOWFLAKE_LEARNING_ARTICLES.length) {
  throw new Error('主教程存在重复 KnowledgeNode 绑定');
}

export const SNOWFLAKE_LEARNING_CONTENT: KnowledgeLearningPack[] = courseNodes.map((node) => {
  const entry = manifestByNodeId.get(node.id);
  const article = articleByNodeId.get(node.id);
  if (!entry || !article || article.id !== node.id) {
    throw new Error(`KnowledgeNode 缺少唯一主教程：${node.id}`);
  }
  return {
    nodeId: node.id,
    articles: [article],
    references: entry.references,
  };
});


export interface IntegratedLearningTutorial {
  id: string;
  title: string;
  description: string;
  level: LearningArticleLevel;
  estimatedMinutes: number;
  linkedKnowledgeNodeIds: string[];
  references: LearningReference[];
  content: string;
}

interface IntegratedTutorialManifestEntry extends Omit<IntegratedLearningTutorial, 'content'> {
  file: string;
}

interface IntegratedLearningManifest {
  schemaVersion: number;
  kind: 'integrated-engineering-tutorials';
  description: string;
  count: number;
  tutorials: IntegratedTutorialManifestEntry[];
}

const typedIntegratedManifest = integratedManifest as IntegratedLearningManifest;
if (typedIntegratedManifest.schemaVersion !== 1 || typedIntegratedManifest.kind !== 'integrated-engineering-tutorials') {
  throw new Error('综合工程教程索引版本无效');
}

const integratedMarkdownModules = import.meta.glob('../../content/courses/snowflake/integrated/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const integratedIds = new Set(typedIntegratedManifest.tutorials.map((tutorial) => tutorial.id));
if (integratedIds.size !== typedIntegratedManifest.tutorials.length ||
    typedIntegratedManifest.count !== typedIntegratedManifest.tutorials.length ||
    typedIntegratedManifest.tutorials.length !== 8) {
  throw new Error('综合工程教程数量或 ID 存在问题');
}

const knownKnowledgeNodeIds = new Set(courseNodes.map((node) => node.id));
export const SNOWFLAKE_INTEGRATED_TUTORIALS: IntegratedLearningTutorial[] =
  typedIntegratedManifest.tutorials.map((entry) => {
    if (!entry.id.startsWith('integrated-') || !entry.title || !entry.description ||
        entry.linkedKnowledgeNodeIds.length === 0 ||
        new Set(entry.linkedKnowledgeNodeIds).size !== entry.linkedKnowledgeNodeIds.length ||
        entry.linkedKnowledgeNodeIds.some((id) => !knownKnowledgeNodeIds.has(id))) {
      throw new Error(`综合教程元数据或关联知识点无效：${entry.id}`);
    }
    const key = `../../content/courses/snowflake/integrated/${entry.file}`;
    const content = integratedMarkdownModules[key];
    if (typeof content !== 'string' || content.length < 1200) {
      throw new Error(`综合工程教程内容缺失或过短：${entry.file}`);
    }
    if (entry.references.length === 0 || entry.references.some((reference) => !/^https:\\/\\//.test(reference.url))) {
      throw new Error(`综合工程教程参考资料无效：${entry.id}`);
    }
    return { ...entry, content };
  });
