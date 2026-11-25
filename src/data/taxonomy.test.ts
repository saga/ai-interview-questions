// AI taxonomy 保持六个 AI 能力域；Snowflake 作为独立课程单独校验，不进入 AI taxonomy。

import { describe, expect, it } from 'vitest';
import {
  ANGLE_WHITELIST,
  DOMAINS,
  FALLBACK_ANGLES,
  TAXONOMY,
  TOPIC_LABELS,
  allowedAnglesFor,
  domainOfTopic,
  groupNodesByDomain,
  groupNodesByTopic,
} from './taxonomy.ts';
import { knowledgeNodes } from './knowledgeMap';
import { questionBank } from './questionBank';
import { CAMPUS_EMPLOYMENT_COURSE_TOPICS, SECURITY_ARCHITECTURE_COURSE_TOPICS, SAP_IT_SERVICE_COURSE_TOPICS, SAP_COURSERA_COURSE_TOPICS, SAP_JUNIOR_PRACTICE_TOPICS } from './learningTracks';

describe('taxonomy 骨架', () => {
  it('AI 学习体系恰为 6 个能力域，且标签齐全', () => {
    expect(DOMAINS).toHaveLength(6);
    expect(new Set(DOMAINS).size).toBe(6);
    for (const d of DOMAINS) expect(TAXONOMY.find((x) => x.id === d)?.label.length).toBeGreaterThan(0);
  });

  it('Snowflake、Security Architecture 与校招面试主题均不属于 AI 能力域 taxonomy', () => {
    expect(domainOfTopic('snowflake')).toBeUndefined();
    expect(domainOfTopic('data-architecture')).toBeUndefined();
    expect(domainOfTopic('data-engineering')).toBeUndefined();
    expect(TAXONOMY.some((domain) => domain.id === 'data-platform')).toBe(false);
    expect(domainOfTopic('security-architecture-governance')).toBeUndefined();
    expect(domainOfTopic('security-zero-trust')).toBeUndefined();
    expect(TAXONOMY.some((domain) => domain.id === 'security-architecture')).toBe(false);
    expect(domainOfTopic('career-motivation-position-fit')).toBeUndefined();
    expect(TAXONOMY.some((domain) => domain.id === 'campus-employment')).toBe(false);
    expect(domainOfTopic('sap-integration')).toBeUndefined();
    expect(TAXONOMY.some((domain) => domain.id === 'sap-consulting')).toBe(false);
  });

  it('topic 在骨架内且标签不重名', () => {
    const ids = TAXONOMY.flatMap((d) => d.topics.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(TOPIC_LABELS[id]?.length).toBeGreaterThan(0);
  });
});

describe('知识节点与 taxonomy 对齐', () => {
  it('AI 知识节点与 AI taxonomy 对齐', () => {
    const validTopics = new Set(Object.keys(TOPIC_LABELS));
    const aiNodes = knowledgeNodes.filter((node) => (node.courseId ?? (node.area === 'data-platform' ? 'snowflake' : 'ai')) === 'ai');
    for (const n of aiNodes) {
      expect(DOMAINS, `节点 ${n.id} 的 AI domain=${n.area} 不在六大域内`).toContain(n.area);
      expect(validTopics, `节点 ${n.id} 的 topic=${n.topic} 不在 AI taxonomy 骨架内`).toContain(n.topic);
      expect(domainOfTopic(n.topic), `节点 ${n.id} 的 AI domain/topic 不自洽`).toBe(n.area);
    }
  });

  it('Snowflake 知识节点仅归属 Snowflake 课程', () => {
    const nodes = knowledgeNodes.filter((node) => node.courseId === 'snowflake');
    expect(nodes.length).toBeGreaterThanOrEqual(39);
    expect(nodes.every((node) => node.area === 'data-platform')).toBe(true);
    expect(nodes.every((node) => ['snowflake', 'postgresql', 'data-architecture', 'data-engineering', 'snowflake-lakehouse', 'snowflake-devops', 'snowflake-data-products', 'snowflake-genai', 'snowflake-agent-ml'].includes(node.topic))).toBe(true);
    const snowflakeQuestionTopics = new Set(questionBank.questions.filter((q) => q.courseId === 'snowflake').map((q) => q.topic));
    for (const node of nodes) expect(snowflakeQuestionTopics.has(node.id), 'Snowflake knowledge node without a question: ' + node.id).toBe(true);
  });

  it('Security Architecture 知识节点与题目独立归属，并覆盖每个节点', () => {
    const nodes = knowledgeNodes.filter((node) => node.courseId === 'security-architecture');
    expect(nodes).toHaveLength(12);
    expect(nodes.every((node) => node.area === 'security-architecture')).toBe(true);
    const themeIds = new Set(SECURITY_ARCHITECTURE_COURSE_TOPICS.map((topic) => topic.id));
    expect(nodes.every((node) => themeIds.has(node.topic))).toBe(true);
    const questions = questionBank.questions.filter((question) => question.courseId === 'security-architecture');
    expect(questions).toHaveLength(24);
    for (const node of nodes) {
      expect(questions.filter((question) => question.topic === node.id).length, `node without question: ${node.id}`).toBeGreaterThanOrEqual(2);
    }
  });


  it('校招面试知识节点与 650 道情境式选择题独立归属，并覆盖全部 15 个主题', () => {
    const nodes = knowledgeNodes.filter((node) => node.courseId === 'campus-employment');
    const questions = questionBank.questions.filter((question) => question.courseId === 'campus-employment');
    const themeIds = new Set(CAMPUS_EMPLOYMENT_COURSE_TOPICS.map((topic) => topic.id));
    expect(nodes).toHaveLength(15);
    expect(nodes.every((node) => node.area === 'campus-employment' && themeIds.has(node.topic))).toBe(true);
    expect(questions).toHaveLength(785);
    for (const node of nodes) {
      const nodeQuestions = questions.filter((question) => question.topic === node.id);
      expect(nodeQuestions.length, `校招知识节点缺少题目：${node.id}`).toBeGreaterThanOrEqual(43);
      expect(nodeQuestions.every((question) => question.knowledgeId === node.id)).toBe(true);
    }
    expect(questions.every((question) => question.formats.choice && !question.formats.open)).toBe(true);
    expect(questions.filter((question) => question.formats.choice?.type === 'single')).toHaveLength(555);
    expect(questions.filter((question) => question.formats.choice?.type === 'multiple')).toHaveLength(230);
  });

  it('SAP IT Service Consultant 知识节点与 720 道题独立归属，并覆盖全部 49 个主题', () => {
    const nodes = knowledgeNodes.filter((node) => node.courseId === 'sap-it-service-consultant');
    const questions = questionBank.questions.filter((question) => question.courseId === 'sap-it-service-consultant');
    const themeIds = new Set([...SAP_IT_SERVICE_COURSE_TOPICS, ...SAP_COURSERA_COURSE_TOPICS, ...SAP_JUNIOR_PRACTICE_TOPICS].map((topic) => topic.id));
    expect(nodes).toHaveLength(49);
    expect(nodes.every((node) => node.area === 'sap-consulting' && themeIds.has(node.topic))).toBe(true);
    expect(questions).toHaveLength(720);
    for (const node of nodes) {
      const nodeQuestions = questions.filter((question) => question.topic === node.id);
      expect(nodeQuestions.length).toBeGreaterThanOrEqual(10);
      expect(nodeQuestions.every((question) => question.knowledgeId === node.id && question.source?.materialId)).toBe(true);
    }
    expect(questions.every((question) => question.formats.choice && !question.formats.open)).toBe(true);
  });

  it('groupNodesByDomain 按域分组且覆盖全部节点（非 AI 课程节点作为独立分组保留）', () => {
    const grouped = groupNodesByDomain(knowledgeNodes);
    const sum = [...grouped.values()].reduce((s, list) => s + list.length, 0);
    expect(sum).toBe(knowledgeNodes.length);
    for (const d of DOMAINS) expect(grouped.get(d)).toBeDefined();
  });

  it('groupNodesByTopic 按 topic 分组', () => {
    const grouped = groupNodesByTopic(knowledgeNodes);
    const sum = [...grouped.values()].reduce((s, list) => s + list.length, 0);
    expect(sum).toBe(knowledgeNodes.length);
  });
});

describe('topic 角度白名单（ADR-038 延伸）', () => {
  const VALID_ANGLES = new Set<string>([
    'definition', 'fundamental', 'mechanism', 'comparison', 'calculation',
    'tradeoff', 'scenario', 'debugging', 'system-design', 'design',
  ]);

  it('白名单的每个 key 都是 taxonomy 中的合法 topic，value 都是合法角度', () => {
    const validTopics = new Set(Object.keys(TOPIC_LABELS));
    for (const [topic, angles] of Object.entries(ANGLE_WHITELIST)) {
      expect(validTopics.has(topic), `白名单含未知 topic: ${topic}`).toBe(true);
      const unique = new Set(angles);
      expect(unique.size, `${topic} 角度有重复`).toBe(angles.length);
      for (const a of angles) expect(VALID_ANGLES.has(a), `${topic} 含非法角度 ${a}`).toBe(true);
    }
  });

  it('allowedAnglesFor：已知 topic 返回其白名单，未知 topic 返回全部 10 角度', () => {
    expect(allowedAnglesFor('inference')).toEqual(ANGLE_WHITELIST['inference']);
    expect(allowedAnglesFor('not-a-real-topic')).toEqual(FALLBACK_ANGLES);
    expect(FALLBACK_ANGLES).toHaveLength(10);
  });
});
