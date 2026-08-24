// taxonomy 不变量：6 大域骨架与真实知识点数据保持一致（ADR-038）。
// 防止知识节点漂移出 taxonomy（域非法 / topic 不在骨架内）。

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

describe('taxonomy 骨架', () => {
  it('恰为 6 大能力域，且标签齐全', () => {
    expect(DOMAINS).toHaveLength(6);
    expect(new Set(DOMAINS).size).toBe(6);
    for (const d of DOMAINS) expect(TAXONOMY.find((x) => x.id === d)?.label.length).toBeGreaterThan(0);
  });

  it('topic 在骨架内且标签不重名', () => {
    const ids = TAXONOMY.flatMap((d) => d.topics.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(TOPIC_LABELS[id]?.length).toBeGreaterThan(0);
  });
});

describe('知识节点与 taxonomy 对齐', () => {
  it('每个知识节点的 domain 属于 6 大域、topic 存在于骨架', () => {
    const validTopics = new Set(Object.keys(TOPIC_LABELS));
    for (const n of knowledgeNodes) {
      expect(DOMAINS, `节点 ${n.id} 的 domain=${n.area} 不在 6 大域内`).toContain(n.area);
      expect(validTopics, `节点 ${n.id} 的 topic=${n.topic} 不在 taxonomy 骨架内`).toContain(n.topic);
      // domain 与 topic 必须自洽：topic 所属域应等于节点 domain
      expect(domainOfTopic(n.topic), `节点 ${n.id} 的 domain/topic 不自洽`).toBe(n.area);
    }
  });

  it('groupNodesByDomain 按域分组且覆盖全部节点', () => {
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
