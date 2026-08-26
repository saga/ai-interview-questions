// 依据「题目蓝图」从零生成全新题（PR5 生成管线前移 + PR6 Dynamic Probe 共用）。
// 安全模型（ADR-036 延伸）：LLM 在蓝图约束内生成 Presentation（题干/选项/解析），
// 概念契约（expectedConcepts / tests）由 domain 校验与映射把关，输出经 buildQuestionFromGeneration 组装。
// 与 generateVariant 不同：variant 是改写已有题；本模块是「蓝图 → 新题」，不依赖原题。

import type { CompleteFn, GeneratedQuestion, KnowledgeNode, QuestionBlueprint } from '../types';
import { testsFromBlueprint } from '../domain/blueprint';
import { extractJSON } from './pi';

const GEN_SYSTEM = `你是一位资深 AI 技术面试官与题目作者。
你的任务不是改写已有题，而是依据给定的"题目蓝图"从零生成一道全新的面试题。
蓝图明确了要考察的概念、考察意图、难度与呈现形态，你必须严格遵从。

【必须保持】
- 只考查蓝图指定的概念（expectedConcepts），不得引入无关或超纲技术；
- 难度与形态必须与蓝图一致；
- 单选题仅 1 个正确选项，多选题 2~4 个正确选项；选项须自包含、互斥、无歧义；
- 开放题必须给出参考作答（referenceAnswer）；
- 题干 self-contained：考生不依赖任何外部材料也能理解并作答。

【输出 JSON】
- question: 题干（必填，自包含）
- angle: 考察角度（字符串，与蓝图一致）
- difficulty: "easy" | "medium" | "hard"
- formats: 对象，按蓝图 format 二选一填：
    "choice": { "type": "single" | "multiple", "options": string[], "answer": number[] }
    "open":   { "referenceAnswer": string }
- explanation: 解析（说明正确结论与常见误解）
- tests: 数组，元素 { "concept": "<概念id>", "role": "primary" | "supporting" }；primary 仅 1 个、supporting 0~2，须覆盖蓝图 expectedConcepts

只输出 JSON，不要任何额外文字。`;

interface RawGeneratedQuestion {
  question?: string;
  angle?: string;
  difficulty?: string;
  formats?: {
    choice?: { type?: string; options?: string[]; answer?: number[] };
    open?: { referenceAnswer?: string };
  };
  explanation?: string;
  tests?: { concept?: string; role?: string }[];
}

/** 把 LLM 原始输出规范化为 GeneratedQuestion（做最小兜底与约束）。 */
function assembleGeneratedQuestion(raw: RawGeneratedQuestion, bp: QuestionBlueprint): GeneratedQuestion {
  const format = bp.format;
  const formats: GeneratedQuestion['formats'] = {};
  if (format === 'open') {
    formats.open = { referenceAnswer: raw.formats?.open?.referenceAnswer ?? raw.explanation ?? '' };
  } else {
    const c = raw.formats?.choice;
    formats.choice = {
      type: c?.type === 'multiple' ? 'multiple' : 'single',
      options: c?.options?.length ? c.options : ['（生成失败）选项A', '（生成失败）选项B'],
      answer: Array.isArray(c?.answer) ? c!.answer : [0],
    };
  }

  // tests：优先用 LLM 给出的；缺省或非法则回退到蓝图映射
  let tests = (raw.tests ?? [])
    .filter((t) => t.concept && t.role)
    .map((t) => ({ concept: String(t.concept), role: t.role === 'supporting' ? ('supporting' as const) : ('primary' as const) }));
  if (tests.length === 0) tests = testsFromBlueprint(bp);

  return {
    question: raw.question ?? '',
    angle: (raw.angle as GeneratedQuestion['angle']) ?? bp.angle,
    difficulty: (raw.difficulty as GeneratedQuestion['difficulty']) ?? bp.difficulty,
    formats,
    explanation: raw.explanation ?? '',
    tests,
  };
}

/**
 * 依据蓝图生成一道新题（确定性编排 + LLM 填空）。
 * @param bp 题目蓝图（概念/意图/难度/形态）
 * @param node 所属知识节点（提供 summary/required 作为背景，可选）
 * @param complete 底层补全函数（由 LLMProvider 注入）
 */
export async function generateQuestionForBlueprint(
  bp: QuestionBlueprint,
  node: KnowledgeNode | undefined,
  complete: CompleteFn,
): Promise<GeneratedQuestion> {
  const user = `【题目蓝图】
${JSON.stringify(bp, null, 2)}

【概念背景（可参考，不强制）】
${node?.summary ?? ''}
required: ${JSON.stringify(node?.required ?? [])}

请依据蓝图生成一道全新题。`;

  const raw = extractJSON<RawGeneratedQuestion>(await complete(GEN_SYSTEM, user));
  return assembleGeneratedQuestion(raw, bp);
}
