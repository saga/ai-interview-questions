// 纯逻辑测试：确定性语言质量门禁（language sanity gate）。
//
// 阈值不是拍的：全部来自对本仓库真实变体池（234 条）的实测校准，
// 见 temp/probe-gate-combo.mjs / temp/probe-clause-order.mjs。
// 关键结论：现有漂移门禁（cjkDice < 35）对 42 条翻译腔变体**一条都没拦住**
// （最小 dice = 39.0），语义有效 ≠ 语言质量，必须有第二道门。

import { describe, it, expect } from 'vitest';
import {
  checkLanguageSanity,
  clauseInversion,
  splitClauses,
  formatSanityIssues,
  LANGUAGE_SANITY_REASON as R,
  MAX_CLAUSE_INVERSION,
} from './languageSanity';

const canonical = {
  stem: '为什么 KV Cache 能降低自回归解码的计算开销？',
  options: [
    '复用已算过的 Key/Value 投影，避免每步重算整个前缀，从而摊薄解码成本',
    '把模型权重量化到 8 bit，减少每次前向的浮点运算量',
    '增大 batch size，让单次前向处理更多请求以摊薄开销',
    '改用更短的上下文窗口，直接减少需要参与计算的 token 数',
  ],
};

/** 一条「干净」的变体：换情境 + 换句式 + 选项重述，但叙述顺序不变。 */
const goodVariant = {
  stem: '某在线服务发现输出越长、单个新 token 越慢，定位后发现每步都在重做同一段前缀的前向计算。根因是什么？',
  options: [
    '每个解码步都在重复计算前缀的 Key/Value 而没有缓存下来，导致开销随长度累积',
    '将模型参数压到 8 bit 精度，以此削减单步前向的浮点计算量',
    '把 batch size 调大，用一次前向同时服务更多请求来降低均摊成本',
    '直接缩短上下文窗口上限，让参与运算的 token 总数变少',
  ],
};

describe('splitClauses', () => {
  it('按句读切分并保留末尾标点', () => {
    expect(splitClauses('先说结论，再说理由；最后补充。')).toEqual(['先说结论，', '再说理由；', '最后补充。']);
  });

  it('空串与无标点输入', () => {
    expect(splitClauses('')).toEqual([]);
    expect(splitClauses('没有标点的一句话')).toEqual(['没有标点的一句话']);
  });
});

describe('clauseInversion', () => {
  it('顺序一致 → 0', () => {
    expect(clauseInversion('先做 A，再做 B；因为 C。', '先做 A，再做 B；因为 C。')).toBe(0);
  });

  it('从句整块倒装 → 100', () => {
    // 机器翻译腔的典型形态：内容还在、顺序全反。
    expect(clauseInversion('先做 A，再做 B；因为 C。', '因为 C。再做 B，先做 A，')).toBe(100);
  });

  it('任一侧分句数 < 2 → 0（无从判定顺序，不惩罚短句）', () => {
    expect(clauseInversion('只有一句。', '也只有一句。')).toBe(0);
    expect(clauseInversion('先做 A，再做 B。', '整句没有标点')).toBe(0);
  });

  it('零字面重叠的重述分句被排除，不制造虚假倒置（回归）', () => {
    // 真实误杀案例：变体末句「导致开销随长度累积」与 canonical 三句都零重叠，
    // greedy 匹配会退化成「取第一个」，若计入则凭空得到 100% 倒置。
    const r = clauseInversion(
      '复用已算过的 Key/Value 投影，避免每步重算整个前缀，从而摊薄解码成本。',
      '每个解码步都在重复计算前缀的 Key/Value 而没有缓存下来，导致开销随长度累积。',
    );
    expect(r).toBe(0);
  });

  it('有效匹配不足 2 个 → 0（证据不足不下结论）', () => {
    expect(clauseInversion('先做 A，再做 B。', '完全不同的内容，另一段全新的表述。')).toBe(0);
  });
});

describe('checkLanguageSanity —— 干净变体放行', () => {
  it('重述级改写、顺序不变 → ok，且无 block', () => {
    const r = checkLanguageSanity(goodVariant, canonical);
    expect(r.ok).toBe(true);
    expect(r.blockCodes).toEqual([]);
  });

  it('翻译腔变体（从句倒装 + 悬空逗号）会被拦 —— 真实池样本', () => {
    // 取自 src/data/variants/evaluation.wb-llm-20260903.json 的实际脏数据。
    const dirty = {
      stem: '你正为团队的客服 Agent 设计上线前的质量保障方案。',
      options: [
        '将评测资源集中于文本品质打分上亦就是可。流程量度既难以量化亦不影响业务成效，因为终端使用者只感知最终产出，中间迹线及器具唤起流程不必纳入考察；聚焦最终回答的语言流畅度及格式规范度做评估，',
      ],
    };
    const c = {
      stem: '评估一个 AI Agent 是否可靠，应从哪些维度切入？',
      options: [
        '聚焦最终回答的语言流畅度与格式规范度做评测，中间轨迹与工具调用过程不必纳入考察；因为终端用户只感知最终输出，过程指标既难以量化也不影响业务结果，把评测资源集中在文本质量打分上就行。',
      ],
    };
    const r = checkLanguageSanity(dirty, c);
    expect(r.ok).toBe(false);
    // 悬空逗号 + 从句倒置，两条都该命中
    expect(r.blockCodes).toContain(R.INCOMPLETE);
    expect(r.blockCodes).toContain(R.CLAUSE_INVERSION);
  });
});

describe('checkLanguageSanity —— 各条 BLOCK 规则', () => {
  const ok = (opts: string[], canon?: string[]) =>
    checkLanguageSanity({ stem: '正常题干？', options: opts }, { stem: canonical.stem, options: canon ?? canonical.options });

  it('GARBLED：零宽字符 / 替换符 / 控制字符', () => {
    expect(ok(['含零宽字符\u200B的选项内容在这里']).blockCodes).toContain(R.GARBLED);
    expect(ok(['含替换符\uFFFD的选项内容在这里']).blockCodes).toContain(R.GARBLED);
    expect(ok(['含控制符\u0000的选项内容在这里']).blockCodes).toContain(R.GARBLED);
  });

  it('DOUBLE_PUNCT：连续同类标点', () => {
    expect(ok(['前面说得都对。；后面这句话重复了']).blockCodes).toContain(R.DOUBLE_PUNCT);
    expect(ok(['中间有个逗号，，然后继续说明']).blockCodes).toContain(R.DOUBLE_PUNCT);
  });

  it('UNBALANCED_BRACKET：括号不配对只作 WARN（半开区间会误报）', () => {
    // 「[0, ∞)」这类半开区间数学写法合法，故本规则不阻断。
    const r = ok(['使用了（未闭合的括号来陈述观点']);
    expect(r.warnCodes).toContain(R.UNBALANCED_BRACKET);
    expect(r.blockCodes).not.toContain(R.UNBALANCED_BRACKET);
    expect(r.ok).toBe(true);
  });

  it('INCOMPLETE：以逗号/顿号/分号收尾', () => {
    expect(ok(['这句话写到一半就断了，']).blockCodes).toContain(R.INCOMPLETE);
    expect(ok(['这句话写到一半就断了；']).blockCodes).toContain(R.INCOMPLETE);
    expect(ok(['这句话是完整的。']).blockCodes).not.toContain(R.INCOMPLETE);
  });

  it('INCOMPLETE 不拦冒号收尾（「下列说法正确的是：」是标准出题写法）', () => {
    // 回归：1308 道 canonical 里 15 处以冒号收尾，全部是合法写法。
    const r = checkLanguageSanity(
      { stem: '关于 KV Cache 的作用机制，下列说法正确的是：', options: ['复用前缀计算结果，降低解码开销'] },
      { stem: canonical.stem, options: canonical.options },
    );
    expect(r.blockCodes).not.toContain(R.INCOMPLETE);
  });

  it('DOUBLE_PUNCT 只拦中文句读，不误伤 :: / ... / !!!', () => {
    // 回归：aten::addmm（C++ 命名空间）、torch.triu(..., x)（省略号）、!!!（强调）都要放行。
    expect(ok(['算子 aten::addmm 在编译期被融合，减少了内核启动次数']).blockCodes).not.toContain(R.DOUBLE_PUNCT);
    expect(ok(['调用 torch.triu(..., diagonal=1) 生成上三角掩码矩阵']).blockCodes).not.toContain(R.DOUBLE_PUNCT);
    expect(ok(['!!! 不要为夏威夷州用户办理开户 !!!']).blockCodes).not.toContain(R.DOUBLE_PUNCT);
    // 中文句读连续堆叠仍然拦
    expect(ok(['前面说得都对。；后面这句话又重复了一遍']).blockCodes).toContain(R.DOUBLE_PUNCT);
  });

  it('TOO_SHORT：选项过短只作 WARN（合法短选项太多）', () => {
    // 回归：「2 倍」「无监督学习」这类短选项在 canonical 里有 40 个，全部合法。
    const r = ok(['是']);
    expect(r.warnCodes).toContain(R.TOO_SHORT);
    expect(r.blockCodes).not.toContain(R.TOO_SHORT);
    expect(ok(['无监督学习']).warnCodes).not.toContain(R.TOO_SHORT);
    expect(ok(['2 倍']).blockCodes).not.toContain(R.TOO_SHORT);
  });

  it('TOO_SHORT 只作用于选项，不作用于题干', () => {
    const r = checkLanguageSanity({ stem: '短干？' }, { stem: canonical.stem });
    expect(r.warnCodes).not.toContain(R.TOO_SHORT);
  });

  it('REPEATED_CLAUSE：只作 WARN，且忽略极短分句', () => {
    // 单字 Dice 对短句分辨力差：「时间复杂度 O(N²·D²)，空间复杂度 O(N²·D)」
    // 语义相反却共享大量字符，会被判成重复——故只报告不阻断。
    const r = ok(['时间复杂度 O(N² · D²)，空间复杂度 O(N² · D)']);
    expect(r.blockCodes).not.toContain(R.REPEATED_CLAUSE);
    // 明显重复时给出 warn
    expect(ok(['复用前缀的计算结果可以省下开销，复用前缀的计算结果可以省下开销。']).warnCodes).toContain(
      R.REPEATED_CLAUSE,
    );
    // 极短分句（如单字符「!」）不参与比对
    expect(ok(['在 Prompt 中加入强语气指令 !!! 不要办理开户 !!!']).warnCodes).not.toContain(R.REPEATED_CLAUSE);
  });

  it('CLAUSE_INVERSION：倒置率达到上限才拦', () => {
    const inv = clauseInversion('先做 A，再做 B；因为 C。', '因为 C。再做 B，先做 A，');
    expect(inv).toBeGreaterThanOrEqual(MAX_CLAUSE_INVERSION);
    const r = checkLanguageSanity(
      { stem: '？', options: ['因为 C。再做 B，先做 A，'] },
      { stem: canonical.stem, options: ['先做 A，再做 B；因为 C。'] },
    );
    expect(r.blockCodes).toContain(R.CLAUSE_INVERSION);
  });
});

describe('checkLanguageSanity —— WARN 不阻断', () => {
  it('汉字与拉丁粘连只是 warn（GPT4 这类紧凑写法合法）', () => {
    const r = checkLanguageSanity(
      { stem: '正常题干？', options: ['使用GPT4之外的方案也可以，这里只是粘连测试'] },
      { stem: canonical.stem, options: canonical.options },
    );
    expect(r.blockCodes).not.toContain(R.CJK_LATIN_GLUE);
    expect(r.warnCodes).toContain(R.CJK_LATIN_GLUE);
    expect(r.ok).toBe(true);
  });
});

describe('formatSanityIssues', () => {
  it('只渲染 block 级问题，带位置下标', () => {
    const r = checkLanguageSanity(
      { stem: '？', options: ['这句话写到一半就断掉了，'] },
      { stem: canonical.stem, options: canonical.options },
    );
    expect(formatSanityIssues(r)).toBe('option[0]: 以逗号/顿号/分号收尾，句子不完整');
  });
});
