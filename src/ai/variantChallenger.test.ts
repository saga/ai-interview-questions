import { describe, expect, it } from 'vitest';
import {
  VARIANT_CHALLENGE_DIMENSIONS,
  buildVariantChallengeUser,
  challengeVariant,
  cheapVariantQualityFlags,
  parseVariantChallenge,
} from './variantChallenger';
import type { Question } from '../schemas/question';

const canonical: Question = {
  id: 'vch-01',
  category: 'inference',
  topic: 'kv-cache',
  tags: [],
  difficulty: 'medium',
  angle: 'mechanism',
  question: '关于 KV cache 的复用条件，以下哪项正确？',
  explanation: '只有在前缀完全命中时才能复用已有 KV；命中率取决于前缀共享程度。',
  formats: {
    choice: {
      type: 'single',
      options: [
        '只有在 KV cache 命中前缀时才能复用已有 KV',
        'KV cache 可以在任意位置复用',
        'KV cache 复用与前缀无关',
        'KV cache 会永久保存所有历史 KV',
      ],
      answer: [0],
    },
  },
};

/**
 * 结构完全合法、但语义走偏的变体：条件被删除（「只有…才」→ 无条件成立）。
 * 刻意让各选项长度与专业度接近——否则会先被确定性预检（信息密度泄题）拦下，
 * 就测不到 LLM 质询那一层。这正是「长度平衡 ≠ 语义保真」的证明。
 */
const drifted = {
  question: '关于 KV cache 的复用，以下哪项说法成立？',
  options: [
    'KV cache 复用已有 KV，因此能减少计算量',
    'KV cache 无法复用已有 KV，需全部重算',
    'KV cache 的复用与前缀命中毫无关系',
    'KV cache 只存在于训练阶段，不用于推理',
  ],
};

const faithful = {
  question: '在推理服务中，什么情况下能够复用先前计算好的 KV？',
  options: [
    '当请求前缀与已缓存前缀完全命中时可以复用',
    '只要显存充足就能在任意位置复用',
    '复用与否完全取决于 batch size',
    '一旦写入即可被任意后续请求复用',
  ],
};

describe('cheapVariantQualityFlags（确定性预检，无 LLM）', () => {
  it('正确项显著更长 + 专业度更高 → 命中信息密度泄题', () => {
    const stuffed = {
      question: canonical.question,
      options: [
        '只有在 KV cache 命中前缀、且 prefix length ≥ 512 tokens、dtype 为 fp16 时才能复用已有 KV（命中率约 73%），需配合 paged attention 的 block table 使用',
        '不行',
        '可以',
        '不确定',
      ],
    };
    const r = cheapVariantQualityFlags(canonical, stuffed, 'choice');
    expect(r?.ok).toBe(false);
    expect(r?.reason).toContain('accidental-clue');
  });

  it('选项规范化后重复 → 命中 diagnostic-value', () => {
    // normalizeOptionText 折叠空白并 trim，故仅差一个全角空格的两个选项会被判为重复。
    const dup = {
      question: canonical.question,
      options: ['可以复用', '可以复用\u3000', '不可复用', '部分可复用'],
    };
    const r = cheapVariantQualityFlags(canonical, dup, 'choice');
    expect(r?.ok).toBe(false);
    expect(r?.reason).toContain('重复');
  });

  it('正常变体返回 null（交回 LLM 质询，不误杀）', () => {
    expect(cheapVariantQualityFlags(canonical, faithful, 'choice')).toBeNull();
  });

  it('开放题不做选项级预检', () => {
    expect(cheapVariantQualityFlags(canonical, { question: 'x' }, 'open')).toBeNull();
  });
});

describe('parseVariantChallenge', () => {
  it('五维全 pass → ok', () => {
    const raw = JSON.stringify({
      dimensions: VARIANT_CHALLENGE_DIMENSIONS.map((d) => ({ dimension: d, pass: true, note: 'ok' })),
      summary: '语义保持一致',
    });
    expect(parseVariantChallenge(raw)).toMatchObject({ ok: true, score: 1, failed: [] });
  });

  it('任一维度 fail → 整条不合格，failed 列出具体维度', () => {
    const raw = JSON.stringify({
      dimensions: VARIANT_CHALLENGE_DIMENSIONS.map((d) => ({
        dimension: d,
        pass: d !== 'answer-preserved',
        note: d === 'answer-preserved' ? '正确项被加了「必须」限定词，真假翻转' : 'ok',
      })),
      summary: '真假属性翻转',
    });
    const r = parseVariantChallenge(raw);
    expect(r.ok).toBe(false);
    expect(r.failed).toEqual(['answer-preserved']);
    expect(r.score).toBeCloseTo(4 / 5);
  });

  it('输出不可解析 → 按不合格处理，不静默放行', () => {
    const r = parseVariantChallenge('这不是 JSON');
    expect(r.ok).toBe(false);
    expect(r.unparsable).toBe(true);
    expect(r.score).toBe(0);
  });
});

describe('buildVariantChallengeUser', () => {
  const prompt = buildVariantChallengeUser(canonical, drifted, 'choice');

  it('原题标注正确项/干扰项，变体不标注（避免模型照抄标注而非读内容）', () => {
    expect(prompt).toContain('←原题正确项');
    expect(prompt).toContain('←原题干扰项');
    // 变体段落里的选项不应带标注
    const variantPart = prompt.split('【变体】')[1];
    expect(variantPart).not.toContain('←原题');
  });

  it('注入解析，供模型判断语义是否漂移', () => {
    expect(prompt).toContain(canonical.explanation);
  });
});

describe('challengeVariant', () => {
  it('确定性预检未过时不再调用 LLM（省钱）', async () => {
    let called = 0;
    const complete = async () => {
      called++;
      return '{}';
    };
    const stuffed = {
      question: canonical.question,
      options: [
        '只有在 KV cache 命中前缀、且 prefix length ≥ 512 tokens、dtype 为 fp16 时才能复用已有 KV，命中率约 73%，需配合 block table 使用',
        '不行',
        '可以',
        '不确定',
      ],
    };
    const r = await challengeVariant(canonical, stuffed, 'choice', complete);
    expect(called).toBe(0);
    expect(r.ok).toBe(false);
  });

  it('语义漂移的变体被质询器拒掉（条件丢失但词汇重合）', async () => {
    const complete = async () =>
      JSON.stringify({
        dimensions: VARIANT_CHALLENGE_DIMENSIONS.map((d) => ({
          dimension: d,
          pass: d !== 'answer-preserved' && d !== 'concept-preserved',
          note: '「只有…才」的条件被删掉，原正确项变成了无条件成立',
        })),
        summary: '条件丢失',
      });
    const r = await challengeVariant(canonical, drifted, 'choice', complete);
    expect(r.ok).toBe(false);
    expect(r.failed).toContain('answer-preserved');
  });
});
