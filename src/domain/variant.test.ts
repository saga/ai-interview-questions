// 纯逻辑测试：LLM 变体候选校验与落地（ADR-036 轻量变体）。
// 契约：LLM 只产出 { question, options }；answer / explanation 恒取 canonical，选项顺序由程序重排。

import { describe, it, expect } from 'vitest';
import {
  applyVariant,
  validateVariant,
  VARIANT_REJECT_REASON,
  STEM_ANCHOR_WARNING,
  variantFingerprint,
  findNearDuplicateVariants,
  VARIANT_DUP_THRESHOLD,
} from './variant';
import type { GeneratedVariant } from '../types';
import type { Question } from '../schemas/question';

const cq: Question = {
  id: 'x',
  category: 'machine-learning',
  topic: 'regularization',
  tags: [],
  difficulty: 'medium',
  question: 'q',
  explanation: 'e',
  formats: {
    choice: {
      type: 'single',
      options: [
        'L2 正则化通过对权重施加平方惩罚来平滑收缩权重',
        '增大 batch size 可以提升训练吞吐',
        '使用梯度裁剪来稳定训练',
      ],
      answer: [0],
    },
  },
};

/** 多选题（两个正确项）：验证多正确项在程序重排后的索引重映射。 */
const cqm: Question = {
  ...cq,
  id: 'xm',
  formats: { choice: { type: 'multiple', options: ['a', 'b', 'c', 'd'], answer: [1, 3] } },
};

const oq: Question = {
  id: 'y',
  category: 'agentic-ai',
  topic: 'memory',
  tags: [],
  difficulty: 'medium',
  question: 'q',
  explanation: 'e',
  formats: { open: { referenceAnswer: 'REF-ANSWER' } },
};

function variant(partial: Partial<GeneratedVariant> = {}): GeneratedVariant {
  // 默认题干含 canonical 锚点（regularization 节点的 required 含 L2 / weight decay），
  // 默认选项与 cq 的 3 个选项一一对应（选择题变体必须提供等长 options）。
  return {
    question: 'L2 正则化通过对权重施加平方惩罚来平滑收缩权重，与 weight decay 在标准 SGD 下等价',
    options: [
      'L2 范数惩罚对权重做平方惩罚以平滑收缩',
      '提升吞吐量的方法是增大 batch size',
      '梯度裁剪用于稳定训练过程',
    ],
    ...partial,
  };
}

describe('validateVariant（结构不变量）', () => {
  it('题干非空 + options 齐全 → 通过', () => {
    expect(validateVariant(cq, variant()).ok).toBe(true);
  });

  it('题干为空 → 拒绝', () => {
    expect(validateVariant(cq, variant({ question: '   ' })).ok).toBe(false);
  });

  it('选择题缺少 options → 拒绝（P0：只改题干不动选项的候选不接受）', () => {
    expect(validateVariant(cq, variant({ options: undefined })).ok).toBe(false);
  });

  it('options 数量与 canonical 不同 → 拒绝（选项须一一对应）', () => {
    expect(validateVariant(cq, variant({ options: ['a', 'b'] })).ok).toBe(false);
    expect(validateVariant(cq, variant({ options: ['a', 'b', 'c', 'd'] })).ok).toBe(false);
  });

  it('options 含空字符串 → 拒绝', () => {
    expect(validateVariant(cq, variant({ options: ['a', '  ', 'c'] })).ok).toBe(false);
  });

  it('options 重复 → 拒绝', () => {
    expect(validateVariant(cq, variant({ options: ['a', 'a', 'b'] })).ok).toBe(false);
  });

  it('含依赖原题指代 → 拒绝', () => {
    expect(validateVariant(cq, variant({ question: '原题中的方案如何？' })).ok).toBe(false);
  });

  it('含新增 forbidden 指代（题目中/题干中/前文/下文）→ 拒绝', () => {
    expect(validateVariant(cq, variant({ question: '题目中提到的方案如何？' })).ok).toBe(false);
    expect(validateVariant(cq, variant({ question: '前文中提到的方案' })).ok).toBe(false);
    expect(validateVariant(cq, variant({ question: '下文所述方案' })).ok).toBe(false);
    expect(validateVariant(cq, variant({ question: '题干中的条件' })).ok).toBe(false);
  });
});

// 第五轮（2026-09-02）：字面锚点由 rejection 降级为 warning，成为**漂移软信号**而非闸门。
// 字面锚点只能证明「题干仍与主题相关」，无法证明语义等价；而变体安全并不依赖它——
// answer / explanation 恒取 canonical，变体改歪也不会判错题。降级后不再误杀换场景的合法变体。
describe('validateVariant（漂移软信号：仅 warning，不阻断）', () => {
  it('完全丢失 topic/tags/required 证据 → 通过，但带 warning', () => {
    const check = validateVariant(cq, variant({ question: '在 CNN 训练中 BatchNorm 为什么不稳定？' }));
    expect(check.ok).toBe(true);
    expect(check.warning).toBe(STEM_ANCHOR_WARNING);
  });

  it('锚点命中 → 通过且无 warning（不再强制 requiredConcepts 2/3 字面覆盖）', () => {
    const check = validateVariant(cq, variant({ question: 'regularization 的本质是什么？' }));
    expect(check.ok).toBe(true);
    expect(check.warning).toBeUndefined();
  });

  it('修复已知误杀：换场景的合法变体现在被采用，只记 warning', () => {
    // 「为什么 KV Cache 能降低 prefill 成本？」→「某服务前缀高度重复却仍重复前向计算，如何降低开销？」
    // 是合法的好变体，但题干无锚点可命中——第四轮会拒（走 fallback 原题），第五轮起只记 warning。
    const check = validateVariant(
      cq,
      variant({ question: '某在线服务发现输入前缀高度重复却仍重复相同计算，如何降低开销？' }),
    );
    expect(check.ok).toBe(true);
    expect(check.warning).toBe(STEM_ANCHOR_WARNING);
  });

  it('证据面仍只看题干：概念只出现在选项里 → 记 warning（不阻断）', () => {
    // 题干（CNN/BatchNorm）无 regularization 锚点，但默认选项是对 cq 选项的 paraphrase，
    // 能通过语义漂移检查；锚点只可能出现在选项里 → 仅记 warning，不阻断。
    expect(
      validateVariant(
        cq,
        variant({
          question: '在 CNN 训练中 batch size 很小时，BatchNorm 为什么不稳定？',
        }),
      ).warning,
    ).toBe(STEM_ANCHOR_WARNING);
  });

  it('GeneratedVariant 契约只含 question/options（无靠解析蒙混的入口）', () => {
    const v = variant({ question: '在 CNN 训练中 BatchNorm 为什么不稳定？' });
    expect(Object.keys(v).sort()).toEqual(['options', 'question']);
    // 契约里没有 explanation/answer，漂移题干只能拿到 warning，无法绕过结构门槛。
    expect(validateVariant(cq, v).ok).toBe(true);
  });

  it('fuzzball 兜底：拼写/形态差异仍视为命中（regularisation ↔ regularization）', () => {
    const cqEn: Question = { ...cq, topic: 'regularisation', tags: [] };
    expect(validateVariant(cqEn, variant({ question: 'regularization 的本质是什么？' })).warning).toBeUndefined();
    expect(validateVariant(cqEn, variant({ question: 'CNN 卷积核大小如何选择？' })).warning).toBe(
      STEM_ANCHOR_WARNING,
    );
  });

  it('fuzzball 兜底：短语级 token_set 对长文本有效（batch statistics ↔ statistics across batch）', () => {
    const q: Question = { ...cq, id: 't', topic: 'layer-normalization', tags: ['batch statistics'] };
    expect(
      validateVariant(
        q,
      variant({
        question: 'LayerNorm does not rely on statistics computed across the batch',
      }),
      ).ok,
    ).toBe(true);
  });
});

// 第五轮：长度泄题检查从 ai/variant.generateVariant 移入 validateVariant。
// 它现在是「唯一校验入口」里的硬门槛之一，且带机器可读 code 供遥测统计 fallback 率。
describe('validateVariant（抗暗示：长度泄题）', () => {
  it('正确项显著过长 → 拒绝，并带 option-length-bias 原因码', () => {
    const check = validateVariant(
      cq,
      variant({
        question: 'L2 正则化为什么能平滑收缩权重？',
        options: [
          'L2 正则化通过对权重施加平方惩罚来平滑收缩权重，与 weight decay 在标准 SGD 下等价，并能显著降低过拟合风险',
          'A',
          'B',
        ],
      }),
    );
    expect(check.ok).toBe(false);
    expect(check.code).toBe(VARIANT_REJECT_REASON.OPTION_LENGTH_BIAS);
    expect(check.reason).toMatch(/长度泄题/);
  });

  it('开放题不执行长度泄题检查（只对 choice 有意义）', () => {
    expect(validateVariant(oq, variant({ options: undefined }), 'open').ok).toBe(true);
  });
});

// P0：选项语义漂移粗粒度防护（optionChangedTooMuch）。
// 用 CJK 感知字符级 Dice（`cjkDice`）拦住「轻量改写突然变成完全不同的选项」，不证明语义等价。
// 阈值 35：合法中文 paraphrase（≈44~74）放行，偷换结论/真假属性（≈5~22）拒绝，与 lexical anchor 降级为 warning 同样的克制。
describe('validateVariant（选项语义漂移防护）', () => {
  // 独立 realistic canonical：正确项 = 选项 0「使用 KV Cache」。
  const driftCq: Question = {
    ...cq,
    id: 'drift',
    question: '为什么 KV Cache 能降低 Transformer 推理的 prefill 成本？',
    formats: {
      choice: {
        type: 'single',
        options: ['使用 KV Cache', '增大 batch size', '使用梯度裁剪'],
        answer: [0],
      },
    },
  };

  it('选项语义变化过大 → fallback（P0：option-semantic-drift）', () => {
    const check = validateVariant(
      driftCq,
      variant({
        question: '为什么 KV Cache 能降低 prefill 成本？',
        options: ['完全不同的技术方案', '增大 batch size', '使用梯度裁剪'],
      }),
    );
    expect(check.ok).toBe(false);
    expect(check.code).toBe(VARIANT_REJECT_REASON.OPTION_SEMANTIC_DRIFT);
    expect(check.reason).toMatch(/改写幅度过大/);
  });

  it('选项轻量改写 → 通过（paraphrase 不应触发 drift）', () => {
    const check = validateVariant(
      driftCq,
      variant({
        question: '为什么 KV Cache 能降低 prefill 成本？',
        options: ['采用 KV Cache', '增大 batch size', '使用梯度裁剪'],
      }),
    );
    expect(check.ok).toBe(true);
  });
});

// 校验对象必须等于最终展示文本：先 normalize 再查去重/空串，
// 否则 "Redis" 与 " Redis " 能逃过检查、却在渲染后变成两个一模一样的选项。
describe('validateVariant（先规范化再校验）', () => {
  it('仅空白差异的两个选项 → 判为重复并拒绝', () => {
    const check = validateVariant(cq, variant({ options: ['Redis', ' Redis ', 'Kafka'] }));
    expect(check.ok).toBe(false);
    expect(check.code).toBe(VARIANT_REJECT_REASON.DUPLICATE_OPTION);
  });

  it('含换行/多空格的选项 → 规范化后判为重复并拒绝', () => {
    const check = validateVariant(cq, variant({ options: ['使用  KV\nCache', '使用 KV Cache', 'RAG'] }));
    expect(check.ok).toBe(false);
    expect(check.code).toBe(VARIANT_REJECT_REASON.DUPLICATE_OPTION);
  });

  it('全空白选项 → 判为空字符串并拒绝', () => {
    const check = validateVariant(cq, variant({ options: ['Redis', '   ', 'Kafka'] }));
    expect(check.ok).toBe(false);
    expect(check.code).toBe(VARIANT_REJECT_REASON.EMPTY_OPTION);
  });

  it('各类结构失败都带机器可读 code（供 fallback 遥测归因）', () => {
    expect(validateVariant(cq, variant({ question: '  ' })).code).toBe(VARIANT_REJECT_REASON.EMPTY_QUESTION);
    expect(validateVariant(cq, variant({ question: '原题中的方案如何？' })).code).toBe(
      VARIANT_REJECT_REASON.FORBIDDEN_REFERENCE,
    );
    expect(validateVariant(cq, variant({ options: undefined })).code).toBe(VARIANT_REJECT_REASON.MISSING_OPTIONS);
    expect(validateVariant(cq, variant({ options: ['a', 'b'] })).code).toBe(
      VARIANT_REJECT_REASON.OPTION_COUNT_MISMATCH,
    );
  });
});

describe('applyVariant（程序结构变换）', () => {
  it('选择题：程序重排后，正确答案文本经索引重映射仍正确（顺序无关）', () => {
    // variant options 与原题按位置一一对应：'a'→'x'、'b'→'y'、'c'→'z'（canonical 正确项 = 'a'）
    const r = applyVariant(cq, variant({ question: 'regularization 变体', options: ['x', 'y', 'z'] }));
    expect(r.question).toBe('regularization 变体');
    expect(new Set(r.formats.choice?.options)).toEqual(new Set(['x', 'y', 'z']));
    expect(r.formats.choice?.options[r.formats.choice.answer[0]]).toBe('x');
  });

  it('多选题：多个正确项全部正确重映射且升序', () => {
    const r = applyVariant(cqm, variant({ options: ['w', 'x', 'y', 'z'] }));
    const answer = r.formats.choice!.answer;
    expect(answer).toEqual([...answer].sort((a, b) => a - b));
    // canonical 正确项 = 索引 1('x') 与 3('z')
    expect(answer.map((i) => r.formats.choice!.options[i]).sort()).toEqual(['x', 'z']);
  });

  // 以下三例锁死「shuffle + answer remap」这条最核心的安全链：
  // 断言的不是索引本身（索引随排列变化），而是「重映射后索引指向的选项仍是原来那个正确选项」。
  it('单选题：确定性 rng 下 shuffle 后 answer 重映射仍指向正确选项', () => {
    // canonical: A B C D，正确项 = 'B'（索引 1）
    const q: Question = {
      ...cq,
      id: 'single-remap',
      formats: { choice: { type: 'single', options: ['A', 'B', 'C', 'D'], answer: [1] } },
    };
    // LLM 逐项改写、位置一一对应：A→'a' … D→'d'，正确项改写为 'b'
    const v = variant({ question: 'regularization 的另一种问法', options: ['a', 'b', 'c', 'd'] });
    // rng=()=>0 的 Fisher–Yates 结果固定为 ['b','c','d','a']（原始索引 [1,2,3,0]）
    const r = applyVariant(q, v, 'choice', () => 0);
    expect(r.formats.choice!.options).toEqual(['b', 'c', 'd', 'a']);
    // 索引确实变化（[1] → [0]），证明重映射真的生效、而不是把 canonical answer 原样透传
    expect(r.formats.choice!.answer).toEqual([0]);
    // 最关键：重映射后的索引指向的仍是正确选项 'b'
    expect(r.formats.choice!.options[r.formats.choice!.answer[0]]).toBe('b');
  });

  it('多选题：确定性 rng 下 shuffle 后被选中的语义集合不变', () => {
    // canonical: A B C D，正确项 = A、C（索引 [0,2]）
    const q: Question = {
      ...cq,
      id: 'multi-remap',
      formats: { choice: { type: 'multiple', options: ['A', 'B', 'C', 'D'], answer: [0, 2] } },
    };
    const v = variant({ question: 'regularization 的多选问法', options: ['a', 'b', 'c', 'd'] });
    const r = applyVariant(q, v, 'choice', () => 0);
    const { options, answer } = r.formats.choice!;
    // 排列同上 ['b','c','d','a']（原始索引 [1,2,3,0]）：
    // 原索引 0('a') 落到新位置 3，原索引 2('c') 落到新位置 1 → 升序 [1,3]
    expect(options).toEqual(['b', 'c', 'd', 'a']);
    expect(answer).toEqual([1, 3]);
    // 不看 answer.length，而是看语义集合：选中的仍是 A、C 的改写 'a'、'c'
    expect(answer.map((i) => options[i]).sort()).toEqual(['a', 'c']);
  });

  it('不变量：任意随机重排下，被选中选项的语义集合恒定（属性测试）', () => {
    // 不依赖任何具体排列，随机 200 次都必须保持「正确选项的语义集合」不变。
    for (let i = 0; i < 200; i++) {
      const r = applyVariant(cq, variant({ options: ['x', 'y', 'z'] }), 'choice');
      const { options, answer } = r.formats.choice!;
      expect(new Set(options)).toEqual(new Set(['x', 'y', 'z']));
      // canonical cq 正确项 = 索引 0 → 改写后为 'x'
      expect(answer.map((j) => options[j])).toEqual(['x']);
    }
    for (let i = 0; i < 200; i++) {
      const r = applyVariant(cqm, variant({ options: ['w', 'x', 'y', 'z'] }), 'choice');
      const { options, answer } = r.formats.choice!;
      // canonical cqm 正确项 = 索引 1、3 → 改写后为 'x'、'z'
      expect(answer.map((j) => options[j]).sort()).toEqual(['x', 'z']);
    }
  });

  it('选择题：规范化的选项文本才进入打乱（渲染文本无多余空白）', () => {
    const r = applyVariant(cq, variant({ options: ['  x ', 'y\n z', 'w'] }), 'choice', () => 0);
    // 与排列无关：规范化后的最终展示文本集合固定，首尾空格与换行都被折叠掉
    expect(new Set(r.formats.choice!.options)).toEqual(new Set(['x', 'y z', 'w']));
    expect(r.formats.choice!.options.every((o) => o === o.trim() && !/[\n\r]|\s{2,}/.test(o))).toBe(true);
  });

  it('注入确定性 rng 时重排结果可复现', () => {
    const a = applyVariant(cq, variant({ options: ['x', 'y', 'z'] }), 'choice', () => 0);
    const b = applyVariant(cq, variant({ options: ['x', 'y', 'z'] }), 'choice', () => 0);
    expect(a.formats.choice?.options).toEqual(b.formats.choice?.options);
    expect(a.formats.choice?.answer).toEqual(b.formats.choice?.answer);
  });

  it('解析永远来自 canonical（LLM 不生成解析）', () => {
    expect(applyVariant(cq, variant({ options: ['x', 'y', 'z'] })).explanation).toBe('e');
  });

  it('开放题：仅替换题干，referenceAnswer 永远保留原题的值', () => {
    const r = applyVariant(oq, variant({ question: 'memory 相关变体' }));
    expect(r.question).toBe('memory 相关变体');
    expect(r.formats.open?.referenceAnswer).toBe('REF-ANSWER');
    expect(r.explanation).toBe('e');
    expect(r.aiGenerated).toBe(true);
  });
});

describe('applyVariant / validateVariant 形态对齐（P0-1）', () => {
  // 双形态题：按本次会话实际形态决定变体结构，而不是永远当选择题。
  const dq: Question = {
    ...cq,
    id: 'd',
    formats: { choice: { type: 'single', options: ['a', 'b', 'c'], answer: [0] }, open: { referenceAnswer: 'REF' } },
  };
  // 仅开放形态、且主题与 variant() 默认题干一致（regularization），用于隔离验证「不传 format」的回退
  const oq2: Question = {
    ...cq,
    id: 'y2',
    formats: { open: { referenceAnswer: 'REF-OPEN' } },
  };

  it('format=open：不要求 options，只替换题干', () => {
    expect(validateVariant(dq, variant({ options: undefined }), 'open').ok).toBe(true);
    const r = applyVariant(dq, variant(), 'open');
    expect(r.formats.open?.referenceAnswer).toBe('REF');
    expect(r.formats.choice?.options).toEqual(['a', 'b', 'c']);
    expect(r.formats.choice?.answer).toEqual([0]);
    expect(r.aiGenerated).toBe(true);
  });

  it('format=choice：缺 options 或数量不符 → 拒绝', () => {
    expect(validateVariant(dq, variant({ options: undefined }), 'choice').ok).toBe(false);
    expect(validateVariant(dq, variant({ options: ['x', 'y'] }), 'choice').ok).toBe(false);
  });

  it('format=choice：改写 options 并程序重排，正确文本经重映射仍正确', () => {
    const r = applyVariant(dq, variant({ options: ['x', 'y', 'z'] }), 'choice');
    expect(new Set(r.formats.choice?.options)).toEqual(new Set(['x', 'y', 'z']));
    expect(r.formats.choice?.options[r.formats.choice.answer[0]]).toBe('x');
  });

  it('不传 format 时回退到 canonical 是否含 choice', () => {
    // dq 含 choice → 视为选择题，缺 options 即拒
    expect(validateVariant(dq, variant({ options: undefined })).ok).toBe(false);
    // oq2 仅 open → 视为开放题，缺 options 无妨
    expect(validateVariant(oq2, variant({ options: undefined })).ok).toBe(true);
  });
});

// 2026-09-03：变体去重规则从 scripts/validate-variants.ts 上提到 domain，
// 让「离线生成器」与「池审计」共用同一条规则——此前 assemble 通道完全绕过了它。
describe('findNearDuplicateVariants（变体间近重复）', () => {
  // 夹具按真实池子的文本比例构造（取自 agentic-10，实测相似度 94）：
  // 题干 ~40 字、4 个选项各 ~110 字 —— **选项文本量约为题干的 10 倍**。
  // 这个比例是理解「为什么只改题干没用」的关键：题干在整体指纹里只占约 1/11 权重，
  // 改得再彻底也拉不动整体相似度。
  const REAL_OPTS = [
    '聚焦最终回答的语言流畅度与格式规范度做评估，中间轨迹与工具调用过程不必纳入考察，因为终端用户只感知最终输出',
    '先做一轮小样本人工抽测，若全部通过即可认定系统可靠，无需再建评测集做回归，偶发长尾问题可由线上监控兜底',
    '循环卡死与上下文溢出属于运维故障而非可靠性问题，不应纳入评估范围，这类故障由基础设施与超时配置负责',
    '从任务成功率、轨迹有效性与工具调用准确率等维度构建评测集做统计化评估，并针对规划偏差、工具误用等失败模式配套缓解手段',
  ];

  it('题干改得很彻底但选项照抄 → 仍判近重复（池子 79 对的成因）', () => {
    const pairs = findNearDuplicateVariants([
      { question: '评估一个 AI Agent 是否可靠，应从哪些维度切入？', options: REAL_OPTS },
      { question: '你正为团队客服 Agent 设计上线前质量保障方案，负责人要求先说清怎样判断可靠', options: REAL_OPTS },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].ratio).toBeGreaterThanOrEqual(VARIANT_DUP_THRESHOLD);
  });

  it('选项做了重述改写（真正多样化）→ 不判近重复（根治的可行解）', () => {
    const pairs = findNearDuplicateVariants([
      { question: '评估一个 AI Agent 是否可靠，应从哪些维度切入？', options: REAL_OPTS },
      {
        question: '你正为团队客服 Agent 设计上线前质量保障方案，负责人要求先说清怎样判断可靠',
        options: [
          '评估只看最终输出的通顺与排版，推理链路和工具调用都不算分，用户只看到答案本身',
          '少量人工抽查全过就当系统稳了，不必做回归评测集，零星长尾靠线上监控接住',
          '死循环和爆上下文是运维层面的事故，不算可靠性范畴，交给基建和超时配置去管',
          '用任务成功率、链路有效性、工具准确率搭评测集做统计，并为规划偏差和工具误用准备兜底',
        ],
      },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('选项仅轻改（同义替换，未真正多样化）→ 仍判近重复（轻改不足以逃出门禁）', () => {
    // 校准：轻改选项级 CJK Dice ≈91，超过阈值 88 → 仍判近重复。
    // 根治单题双变体选项雷同要求选项被「重述」而非「轻改」。
    const pairs = findNearDuplicateVariants([
      { question: '评估一个 AI Agent 是否可靠，应从哪些维度切入？', options: REAL_OPTS },
      {
        question: '你正为团队客服 Agent 设计上线前质量保障方案，负责人要求先说清怎样判断可靠',
        options: [
          '只评估最终回答的流畅度与格式规范度，中间轨迹与工具调用过程不用纳入，终端用户只感知最终输出',
          '做一轮小样本人工抽测，全部通过就认定系统可靠，无需再建评测集回归，长尾问题交给线上监控兜底',
          '循环卡死与上下文溢出属于运维故障而非可靠性问题，不应纳入评估范围，由基础设施与超时配置负责',
          '从任务成功率、轨迹有效性与工具调用准确率等维度建评测集做统计化评估，并针对规划偏差、工具误用配套缓解手段',
        ],
      },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].ratio).toBeGreaterThanOrEqual(VARIANT_DUP_THRESHOLD);
  });

  it('完全相同的两条 → 判近重复', () => {
    const v = { question: '同一个题干', options: REAL_OPTS };
    expect(findNearDuplicateVariants([v, { ...v }])).toHaveLength(1);
  });

  it('单个变体不产生配对；阈值可调', () => {
    expect(findNearDuplicateVariants([{ question: 'a', options: REAL_OPTS }])).toHaveLength(0);
    const list = [
      { question: '评估切入点', options: REAL_OPTS },
      { question: '上线前质量保障方案', options: REAL_OPTS },
    ];
    // 阈值抬到 101 → 无论如何都不配对
    expect(findNearDuplicateVariants(list, 101)).toHaveLength(0);
    // 阈值压到 0 → 任意两条都配对
    expect(findNearDuplicateVariants(list, 0)).toHaveLength(1);
  });

  it('指纹把选项计入（选项相同则指纹相同）', () => {
    expect(variantFingerprint({ question: '甲', options: REAL_OPTS })).not.toBe(
      variantFingerprint({ question: '乙', options: REAL_OPTS }),
    );
    // 指纹对空白不敏感（与校验/渲染共用规范化）
    expect(variantFingerprint({ question: ' 甲 ', options: ['  x ', 'y'] })).toBe(
      variantFingerprint({ question: '甲', options: ['x', 'y'] }),
    );
  });
});
