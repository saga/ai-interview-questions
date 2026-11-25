import type { KnowledgeNode } from '../schemas/knowledge';
import type { LearnerProfile } from '../schemas/learner';
import type { LearningTrackId } from '../data/learningTracks';
import {
  CAMPUS_EMPLOYMENT_COURSE_TOPICS,
  SAP_COURSERA_COURSE_TOPICS,
  SAP_IT_SERVICE_COURSE_TOPICS,
  SAP_JUNIOR_PRACTICE_TOPICS,
  SECURITY_ARCHITECTURE_COURSE_TOPICS,
  SNOWFLAKE_COURSE_TOPICS,
  getLearningTrack,
} from '../data/learningTracks';
import { TAXONOMY, topicLabel } from '../data/taxonomy';
import { knowledgeForTrack, profileForTrack } from './learningTracks';
import { WEAK_AVG, WEAK_MASTERY } from './learner';

export type LearningMapStatus = 'unstarted' | 'weak' | 'mastered';

export interface LearningMapConcept extends KnowledgeNode {
  attempts: number;
  avgScore: number;
  mastery: number;
  status: 'unassessed' | 'learning' | 'weak' | 'mastered';
  positiveEvidence: number;
  negativeEvidence: number;
  practiceSessions: number;
  lastSeenAt?: number;
}

export interface LearningMapTopic {
  id: string;
  label: string;
  description?: string;
  priority: KnowledgeNode['priority'];
  status: LearningMapStatus;
  attempts: number;
  avgScore: number;
  mastery: number;
  conceptCount: number;
  assessedConcepts: number;
  masteredConcepts: number;
  concepts: LearningMapConcept[];
}

export interface LearningMapBranch {
  id: string;
  label: string;
  topics: LearningMapTopic[];
  totalTopics: number;
  attemptedTopics: number;
  masteredTopics: number;
  weakTopics: number;
  unstartedTopics: number;
  coveragePercent: number;
  masteryPercent: number;
}

export interface LearningMapReport {
  trackId: LearningTrackId;
  trackTitle: string;
  totalTopics: number;
  attemptedTopics: number;
  masteredTopics: number;
  weakTopics: number;
  unstartedTopics: number;
  coveragePercent: number;
  masteryPercent: number;
  totalConcepts: number;
  branches: LearningMapBranch[];
  recommendations: LearningMapTopic[];
}

export interface LearningMapGraphNode {
  id: string;
  name: string;
  data: {
    kind: 'root' | 'branch' | 'topic';
    label: string;
    status?: LearningMapStatus;
    topicId?: string;
    branchId?: string;
    masteryPercent?: number;
    masteredTopics?: number;
    totalTopics?: number;
    detail: string;
  };
}

export interface LearningMapGraphData {
  nodes: LearningMapGraphNode[];
  edges: { id: string; source: string; target: string }[];
}

interface BranchDefinition {
  id: string;
  label: string;
  topicIds: string[];
}

const SNOWFLAKE_BRANCHES: BranchDefinition[] = [
  { id: 'platform-foundations', label: '平台与数据库', topicIds: ['snowflake', 'postgresql'] },
  { id: 'data-foundation', label: '数据架构与工程', topicIds: ['data-architecture', 'data-engineering', 'snowflake-lakehouse', 'snowflake-devops'] },
  { id: 'data-products-ai', label: '数据产品与智能应用', topicIds: ['snowflake-data-products', 'snowflake-genai', 'snowflake-agent-ml'] },
];

const SAP_BRANCHES: BranchDefinition[] = [
  { id: 'sap-core', label: 'SAP 顾问核心课程', topicIds: SAP_IT_SERVICE_COURSE_TOPICS.map((item) => item.id) },
  { id: 'sap-technology-consultant', label: 'Technology Consultant 补充', topicIds: SAP_COURSERA_COURSE_TOPICS.map((item) => item.id) },
  { id: 'sap-graduate-practice', label: '毕业生客户项目实践', topicIds: SAP_JUNIOR_PRACTICE_TOPICS.map((item) => item.id) },
];

const SECURITY_BRANCHES: BranchDefinition[] = [
  { id: 'security-governance', label: '治理、需求与威胁分析', topicIds: ['security-architecture-governance', 'security-requirements', 'security-threat-modeling'] },
  { id: 'security-controls', label: '身份、访问与数据保护', topicIds: ['security-identity-access', 'security-zero-trust', 'security-data-protection', 'security-application-integration'] },
  { id: 'security-platform-operations', label: '平台、供应链与安全运营', topicIds: ['security-cloud-platform', 'security-supply-chain', 'security-resilience-operations', 'security-financial-services'] },
];

const COURSE_TOPIC_LABELS = new Map<string, string>([
  ...SNOWFLAKE_COURSE_TOPICS,
  ...SECURITY_ARCHITECTURE_COURSE_TOPICS,
  ...CAMPUS_EMPLOYMENT_COURSE_TOPICS,
  ...SAP_IT_SERVICE_COURSE_TOPICS,
  ...SAP_COURSERA_COURSE_TOPICS,
  ...SAP_JUNIOR_PRACTICE_TOPICS,
].map((topic) => [topic.id, topic.label]));

const CAMPUS_BRANCHES: BranchDefinition[] = [
  { id: 'career-direction', label: '岗位认知与职业规划', topicIds: ['career-motivation-position-fit', 'career-planning-offer'] },
  { id: 'experience-expression', label: '经历表达与面试沟通', topicIds: ['self-introduction-positioning', 'resume-project-storytelling', 'interview-communication', 'undergrad-grad-transition'] },
  { id: 'teamwork-delivery', label: '团队协作与可靠交付', topicIds: ['teamwork-collaboration', 'communication-conflict', 'ownership-reliable-delivery', 'problem-solving-initiative', 'time-prioritization-pressure'] },
  { id: 'business-professionalism', label: '业务价值与职业素养', topicIds: ['learning-adaptability-ai', 'self-awareness-feedback', 'business-user-value', 'professional-ethics-engineering'] },
];

function definitionsForTrack(trackId: LearningTrackId): BranchDefinition[] {
  if (trackId === 'ai') {
    return TAXONOMY.map((domain) => ({
      id: domain.id,
      label: domain.label,
      topicIds: domain.topics.map((topic) => topic.id),
    }));
  }
  if (trackId === 'snowflake') return SNOWFLAKE_BRANCHES;
  if (trackId === 'sap-it-service-consultant') return SAP_BRANCHES;
  if (trackId === 'security-architecture') return SECURITY_BRANCHES;
  return CAMPUS_BRANCHES;
}

function statusOf(attempts: number, mastery: number, avgScore: number): LearningMapStatus {
  if (attempts <= 0) return 'unstarted';
  return mastery >= WEAK_MASTERY || avgScore >= WEAK_AVG ? 'mastered' : 'weak';
}

function summarizeBranch(id: string, label: string, topics: LearningMapTopic[]): LearningMapBranch {
  const totalTopics = topics.length;
  const attemptedTopics = topics.filter((topic) => topic.status !== 'unstarted').length;
  const masteredTopics = topics.filter((topic) => topic.status === 'mastered').length;
  const weakTopics = topics.filter((topic) => topic.status === 'weak').length;
  const unstartedTopics = totalTopics - attemptedTopics;
  return {
    id,
    label,
    topics,
    totalTopics,
    attemptedTopics,
    masteredTopics,
    weakTopics,
    unstartedTopics,
    coveragePercent: totalTopics ? Math.round((attemptedTopics / totalTopics) * 100) : 0,
    masteryPercent: totalTopics ? Math.round((masteredTopics / totalTopics) * 100) : 0,
  };
}

/**
 * 为当前学习体系构建 topic 层学习地图。
 * Learner Memory 的统计粒度是 topic，因此同一个 topic 下的多个 KnowledgeNode 只计一次；
 * conceptCount 只作为分支细节展示，不虚增已学习数量。
 */
export function buildLearningMapReport(
  trackId: LearningTrackId,
  profile: LearnerProfile,
  allNodes: KnowledgeNode[],
): LearningMapReport {
  const nodes = knowledgeForTrack(allNodes, trackId);
  const trackProfile = profileForTrack(profile, trackId, allNodes);
  const byTopic = new Map<string, KnowledgeNode[]>();
  for (const node of nodes) {
    const group = byTopic.get(node.topic) ?? [];
    group.push(node);
    byTopic.set(node.topic, group);
  }

  const topicMap = new Map<string, LearningMapTopic>();
  for (const [topicId, concepts] of byTopic) {
    const stat = trackProfile.topicStats[topicId];
    const attempts = stat?.attempts ?? 0;
    const avgScore = stat?.avgScore ?? 0;
    const mastery = stat?.mastery ?? 0;
    const priorityRank: Record<KnowledgeNode['priority'], number> = { P0: 0, P1: 1, P2: 2 };
    const priority = [...concepts].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])[0]?.priority ?? 'P1';
    const conceptProgress: LearningMapConcept[] = concepts.map((node) => {
      const evidence = trackProfile.knowledgeStats?.[node.id];
      const assessed = Boolean(evidence && evidence.attempts > 0);
      const status: LearningMapConcept['status'] = !assessed ? 'unassessed'
        : evidence!.mastery >= WEAK_MASTERY ? 'mastered'
          : evidence!.avgScore >= 50 ? 'learning' : 'weak';
      return {
        ...node,
        attempts: evidence?.attempts ?? 0,
        avgScore: evidence?.avgScore ?? 0,
        mastery: evidence?.mastery ?? 0,
        status,
        positiveEvidence: evidence?.positiveEvidence ?? 0,
        negativeEvidence: evidence?.negativeEvidence ?? 0,
        practiceSessions: evidence?.practiceSessions ?? 0,
        lastSeenAt: evidence?.lastSeenAt,
      };
    }).sort((a, b) => {
      const rank: Record<LearningMapConcept['status'], number> = { weak: 0, learning: 1, unassessed: 2, mastered: 3 };
      return rank[a.status] - rank[b.status] || a.name.localeCompare(b.name, 'zh-CN');
    });
    topicMap.set(topicId, {
      id: topicId,
      label: COURSE_TOPIC_LABELS.get(topicId) ?? topicLabel(topicId),
      priority,
      status: statusOf(attempts, mastery, avgScore),
      attempts,
      avgScore,
      mastery,
      conceptCount: concepts.length,
      assessedConcepts: conceptProgress.filter((node) => node.status !== 'unassessed').length,
      masteredConcepts: conceptProgress.filter((node) => node.status === 'mastered').length,
      concepts: conceptProgress,
    });
  }

  const branches = definitionsForTrack(trackId).map((definition) => {
    const topics = definition.topicIds
      .map((topicId) => topicMap.get(topicId))
      .filter((topic): topic is LearningMapTopic => Boolean(topic))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
    return summarizeBranch(definition.id, definition.label, topics);
  }).filter((branch) => branch.totalTopics > 0);

  const assigned = new Set(branches.flatMap((branch) => branch.topics.map((topic) => topic.id)));
  const unassigned = [...topicMap.values()].filter((topic) => !assigned.has(topic.id));
  if (unassigned.length > 0) {
    branches.push(summarizeBranch('other', '其他知识主题', unassigned));
  }

  const allTopics = branches.flatMap((branch) => branch.topics);
  const totalTopics = allTopics.length;
  const attemptedTopics = allTopics.filter((topic) => topic.status !== 'unstarted').length;
  const masteredTopics = allTopics.filter((topic) => topic.status === 'mastered').length;
  const weakTopics = allTopics.filter((topic) => topic.status === 'weak').length;
  const unstartedTopics = totalTopics - attemptedTopics;
  const priorityRank: Record<KnowledgeNode['priority'], number> = { P0: 0, P1: 1, P2: 2 };
  const statusRank: Record<LearningMapStatus, number> = { weak: 0, unstarted: 1, mastered: 2 };
  const recommendations = [...allTopics]
    .filter((topic) => topic.status !== 'mastered')
    .sort((a, b) =>
      statusRank[a.status] - statusRank[b.status] ||
      priorityRank[a.priority] - priorityRank[b.priority] ||
      a.mastery - b.mastery ||
      a.label.localeCompare(b.label, 'zh-CN'),
    );

  const track = getLearningTrack(trackId);
  return {
    trackId,
    trackTitle: track.title,
    totalTopics,
    attemptedTopics,
    masteredTopics,
    weakTopics,
    unstartedTopics,
    coveragePercent: totalTopics ? Math.round((attemptedTopics / totalTopics) * 100) : 0,
    masteryPercent: totalTopics ? Math.round((masteredTopics / totalTopics) * 100) : 0,
    totalConcepts: nodes.length,
    branches,
    recommendations,
  };
}

export function buildLearningMapGraphData(report: LearningMapReport): LearningMapGraphData {
  const rootId = 'learning-map-root';
  const rootLabel = `${getLearningTrack(report.trackId).shortTitle} · ${report.masteredTopics}/${report.totalTopics} 已掌握（${report.masteryPercent}%）`;
  const nodes: LearningMapGraphNode[] = [{
    id: rootId,
    name: rootLabel,
    data: {
      kind: 'root',
      label: rootLabel,
      detail: `已接触 ${report.attemptedTopics}/${report.totalTopics} 个主题，尚有 ${report.unstartedTopics} 个未开始、${report.weakTopics} 个待加强`,
    },
  }];
  const edges: LearningMapGraphData['edges'] = [];
  for (const branch of report.branches) {
    const branchId = `branch:${branch.id}`;
    const branchLabel = `${branch.label} · ${branch.masteredTopics}/${branch.totalTopics}（${branch.masteryPercent}%）`;
    nodes.push({
      id: branchId,
      name: branchLabel,
      data: {
        kind: 'branch',
        label: branchLabel,
        branchId: branch.id,
        masteryPercent: branch.masteryPercent,
        masteredTopics: branch.masteredTopics,
        totalTopics: branch.totalTopics,
        detail: `已掌握 ${branch.masteredTopics}/${branch.totalTopics}（${branch.masteryPercent}%）· 已接触 ${branch.attemptedTopics}/${branch.totalTopics} · 待加强 ${branch.weakTopics} · 未开始 ${branch.unstartedTopics}`,
      },
    });
    edges.push({ id: `${rootId}→${branchId}`, source: rootId, target: branchId });
    for (const topic of branch.topics) {
      const topicId = `topic:${topic.id}`;
      const statusLabel = topic.status === 'mastered' ? '已掌握' : topic.status === 'weak' ? '待加强' : '未开始';
      const topicLabelText = `${topic.label} · ${topic.status === 'unstarted' ? statusLabel : `${Math.round(topic.mastery * 100)}%`}`;
      nodes.push({
        id: topicId,
        name: topicLabelText,
        data: {
          kind: 'topic',
          label: topicLabelText,
          status: topic.status,
          topicId: topic.id,
          branchId: branch.id,
          detail: `${statusLabel} · ${topic.attempts} 次作答 · 均分 ${topic.avgScore}`,
        },
      });
      edges.push({ id: `${branchId}→${topicId}`, source: branchId, target: topicId });
    }
  }
  return { nodes, edges };
}
