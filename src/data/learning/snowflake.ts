import manifest from '../../content/courses/snowflake/index.json';
import { knowledgeNodes } from '../knowledgeMap';

export type LearningArticleKind = 'core' | 'deep-dive' | 'case-study';
export type LearningArticleLevel = 'foundation' | 'intermediate' | 'advanced';
export type LearningReferenceKind = 'official' | 'paper' | 'standard' | 'engineering' | 'case' | 'book';

export interface LearningArticle {
  id: string;
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
  articles: LearningArticle[];
  references: LearningReference[];
}

interface ArticleManifestEntry extends Omit<LearningArticle, 'content'> {
  file: string;
  topics: string[];
  references: LearningReference[];
}

interface LearningManifest {
  overview: {
    introduction: string;
    audience: string;
    objectives: string[];
    roadmap: string[];
    notes: string;
  };
  articles: ArticleManifestEntry[];
}

const typedManifest = manifest as LearningManifest;
const markdownModules = import.meta.glob('../../content/courses/snowflake/articles/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

export const SNOWFLAKE_LEARNING_OVERVIEW = typedManifest.overview;

export const SNOWFLAKE_LEARNING_ARTICLES: LearningArticle[] = typedManifest.articles.map((entry) => {
  const key = `../../content/courses/snowflake/articles/${entry.file}`;
  const content = markdownModules[key];
  if (typeof content !== 'string') throw new Error(`课程文章未找到：${entry.file}`);
  return {
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    level: entry.level,
    estimatedMinutes: entry.estimatedMinutes,
    content,
  };
});

const articleById = new Map(SNOWFLAKE_LEARNING_ARTICLES.map((article) => [article.id, article]));
if (articleById.size !== SNOWFLAKE_LEARNING_ARTICLES.length) {
  throw new Error('Snowflake 教材索引存在重复 article id');
}

const manifestByTopic = new Map<string, ArticleManifestEntry[]>();
for (const entry of typedManifest.articles) {
  for (const topic of entry.topics) {
    const current = manifestByTopic.get(topic) ?? [];
    current.push(entry);
    manifestByTopic.set(topic, current);
  }
}

function isSnowflakeNode(node: (typeof knowledgeNodes)[number]): boolean {
  return node.courseId === 'snowflake' || (!node.courseId && node.area === 'data-platform');
}

function referencesFor(entries: ArticleManifestEntry[]): LearningReference[] {
  const seen = new Set<string>();
  return entries.flatMap((entry) => entry.references).filter((reference) => {
    if (seen.has(reference.id)) return false;
    seen.add(reference.id);
    return true;
  });
}

/** 每个 KnowledgeNode 自动关联所属课程主题的教材，不再手工维护五个 P0 pack。 */
export const SNOWFLAKE_LEARNING_CONTENT: KnowledgeLearningPack[] = knowledgeNodes
  .filter(isSnowflakeNode)
  .map((node) => {
    const entries = manifestByTopic.get(node.topic) ?? [];
    return {
      nodeId: node.id,
      articles: entries.map((entry) => articleById.get(entry.id)).filter((article): article is LearningArticle => Boolean(article)),
      references: referencesFor(entries),
    };
  });
