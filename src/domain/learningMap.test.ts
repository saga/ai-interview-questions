import { describe, expect, it } from 'vitest';
import type { KnowledgeNode } from '../schemas/knowledge';
import { LEARNING_TRACKS } from '../data/learningTracks';
import { knowledgeNodes } from '../data/knowledgeMap';
import { knowledgeForTrack } from './learningTracks';
import { emptyProfile } from './learner';
import {
  buildLearningMapGraphData,
  buildLearningMapReport,
  type LearningMapStatus,
} from './learningMap';

function node(input: Partial<KnowledgeNode> & Pick<KnowledgeNode, 'id' | 'name' | 'topic' | 'area'>): KnowledgeNode {
  return {
    id: input.id,
    name: input.name,
    area: input.area,
    topic: input.topic,
    priority: input.priority ?? 'P1',
    summary: input.summary ?? input.name,
    required: [],
    misconceptions: [],
    angles: ['scenario'],
    ...(input.courseId ? { courseId: input.courseId } : {}),
  };
}

function addStat(profile: ReturnType<typeof emptyProfile>, topic: string, mastery: number, avgScore = 70, attempts = 2) {
  profile.topicStats[topic] = {
    attempts,
    avgScore,
    lastScore: avgScore,
    trend: 'flat',
    mastery,
    practiceSessions: attempts > 1 ? 2 : 1,
    commonWeaknesses: [],
    lastSeen: 1,
  };
}

describe('learning map progress projection', () => {
  it('同一个 topic 下的多个知识点只计为一个学习主题', () => {
    const nodes = [
      node({ id: 'agent-fundamentals', name: 'Agent 基础', area: 'agent-engineering', topic: 'agent-fundamentals', priority: 'P0' }),
      node({ id: 'agent-loop', name: 'Agent 执行循环', area: 'agent-engineering', topic: 'agent-fundamentals', priority: 'P0' }),
      node({ id: 'agent-planning', name: 'Agent 规划', area: 'agent-engineering', topic: 'planning' }),
    ];
    const profile = emptyProfile();
    addStat(profile, 'agent-fundamentals', 0.8, 82);

    const report = buildLearningMapReport('ai', profile, nodes);
    const branch = report.branches.find((item) => item.id === 'agent-engineering');

    expect(report.totalTopics).toBe(2);
    expect(report.totalConcepts).toBe(3);
    expect(report.attemptedTopics).toBe(1);
    expect(report.masteredTopics).toBe(1);
    expect(branch?.totalTopics).toBe(2);
    expect(branch?.topics.find((item) => item.id === 'agent-fundamentals')).toMatchObject({
      conceptCount: 2,
      status: 'mastered',
      attempts: 2,
    });
  });

  it('沿用进度页掌握判定，并区分未开始、待加强和已掌握', () => {
    const nodes = [
      node({ id: 'sap-a', name: '核心主题 A', area: 'sap-consulting', topic: 'sap-consulting-foundations', courseId: 'sap-it-service-consultant' }),
      node({ id: 'sap-b', name: '核心主题 B', area: 'sap-consulting', topic: 'sap-discovery-requirements', courseId: 'sap-it-service-consultant' }),
      node({ id: 'sap-c', name: '核心主题 C', area: 'sap-consulting', topic: 'sap-business-processes', courseId: 'sap-it-service-consultant' }),
    ];
    const profile = emptyProfile();
    addStat(profile, 'sap-consulting-foundations', 0.25, 48);
    // 与进度页规则一致：mastery 达标即视为掌握，即使单独的均分尚未到 75。
    addStat(profile, 'sap-discovery-requirements', 0.76, 68);

    const report = buildLearningMapReport('sap-it-service-consultant', profile, nodes);
    const statusByTopic = Object.fromEntries(
      report.branches.flatMap((branch) => branch.topics.map((topic) => [topic.id, topic.status])),
    ) as Record<string, LearningMapStatus>;

    expect(statusByTopic).toEqual({
      'sap-consulting-foundations': 'weak',
      'sap-discovery-requirements': 'mastered',
      'sap-business-processes': 'unstarted',
    });
    expect(report).toMatchObject({
      totalTopics: 3,
      attemptedTopics: 2,
      masteredTopics: 1,
      weakTopics: 1,
      unstartedTopics: 1,
      coveragePercent: 67,
      masteryPercent: 33,
    });
    expect(report.recommendations.map((item) => item.id)).toEqual([
      'sap-consulting-foundations',
      'sap-business-processes',
    ]);
  });

  it('Snowflake 主题按平台、数据工程和应用分支组织，空分支不展示', () => {
    const nodes = [
      node({ id: 'sf', name: 'Snowflake 基础', area: 'data-platform', topic: 'snowflake', courseId: 'snowflake' }),
      node({ id: 'pg', name: 'PostgreSQL', area: 'data-platform', topic: 'postgresql', courseId: 'snowflake' }),
      node({ id: 'de', name: 'Data Engineering', area: 'data-platform', topic: 'data-engineering', courseId: 'snowflake' }),
      node({ id: 'agent', name: 'Cortex Agent', area: 'data-platform', topic: 'snowflake-agent-ml', courseId: 'snowflake' }),
    ];

    const report = buildLearningMapReport('snowflake', emptyProfile(), nodes);
    expect(report.branches.map((branch) => branch.id)).toEqual([
      'platform-foundations',
      'data-foundation',
      'data-products-ai',
    ]);
    expect(report.branches.map((branch) => branch.totalTopics)).toEqual([2, 1, 1]);
    expect(report.unstartedTopics).toBe(4);
    expect(report.coveragePercent).toBe(0);
  });

  it('SAP 课程按核心、Technology Consultant 和毕业生实践拆分', () => {
    const nodes = [
      node({ id: 'sap-core', name: 'SAP 核心', area: 'sap-consulting', topic: 'sap-consulting-foundations', courseId: 'sap-it-service-consultant' }),
      node({ id: 'sap-coursera', name: '实施课程', area: 'sap-consulting', topic: 'sap-professional-practice', courseId: 'sap-it-service-consultant' }),
      node({ id: 'sap-junior', name: '客户沟通', area: 'sap-consulting', topic: 'sap-client-communication', courseId: 'sap-it-service-consultant' }),
    ];
    const report = buildLearningMapReport('sap-it-service-consultant', emptyProfile(), nodes);
    expect(report.branches.map((branch) => [branch.id, branch.totalTopics])).toEqual([
      ['sap-core', 1],
      ['sap-technology-consultant', 1],
      ['sap-graduate-practice', 1],
    ]);
  });

  it('未纳入目录的知识主题进入“其他知识主题”，不会被静默遗漏', () => {
    const nodes = [
      node({ id: 'security-custom', name: '新增主题', area: 'security-architecture', topic: 'security-custom-topic', courseId: 'security-architecture' }),
    ];
    const report = buildLearningMapReport('security-architecture', emptyProfile(), nodes);
    expect(report.branches).toHaveLength(1);
    expect(report.branches[0]).toMatchObject({ id: 'other', label: '其他知识主题', totalTopics: 1 });
  });

  it('五个学习体系的每个 topic 都恰好进入一个地图分支', () => {
    for (const track of LEARNING_TRACKS) {
      const expected = new Set(knowledgeForTrack(knowledgeNodes, track.id).map((item) => item.topic));
      const report = buildLearningMapReport(track.id, emptyProfile(), knowledgeNodes);
      const actual = report.branches.flatMap((branch) => branch.topics.map((topic) => topic.id));
      expect(report.totalTopics).toBe(expected.size);
      expect(new Set(actual).size).toBe(actual.length);
      expect(new Set(actual)).toEqual(expected);
    }
  });

  it('G6Lite 图数据包含唯一节点 ID、完整分支连线和 topic 选择信息', () => {
    const nodes = [
      node({ id: 'agent-fundamentals', name: 'Agent 基础', area: 'agent-engineering', topic: 'agent-fundamentals', priority: 'P0' }),
      node({ id: 'tool-calling', name: '工具调用', area: 'agent-engineering', topic: 'tool-calling', priority: 'P1' }),
    ];
    const report = buildLearningMapReport('ai', emptyProfile(), nodes);
    const graph = buildLearningMapGraphData(report);
    const ids = graph.nodes.map((item) => item.id);
    const topic = graph.nodes.find((item) => item.id === 'topic:agent-fundamentals');

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('learning-map-root');
    expect(ids).toContain('branch:agent-engineering');
    expect(graph.edges).toHaveLength(3);
    expect(topic?.data).toMatchObject({
      kind: 'topic',
      topicId: 'agent-fundamentals',
      status: 'unstarted',
    });
  });
});
