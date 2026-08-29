// Agent 工具层：把现有 domain / learner / evaluation / ai 能力包装成 pi-agent-core 的 AgentTool。
// 设计红线（对齐 AGENTS.md 与计划）：
// - 工具只做「确定性执行」，不含业务决策；Agent 负责决策；
// - 评分委托现有逻辑：选择题 → gradeChoice（无 LLM），开放题 → LLMProvider.evaluateOpenAnswer；
//   Agent 只读取 EvaluationResult，绝不自己打分；
// - 工具参数 schema 用 TypeBox（pi-agent-core 要求），与项目既有 Zod 不冲突。

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { AnswerValue, LLMProvider } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { LearnerProfile } from '../schemas/learner';
import type { Question } from '../schemas/question';
import type { SessionQuestion } from '../schemas/session';
import { availableFormats } from '../domain/quiz';
import { gradeChoice, DEFAULT_RUBRIC } from '../domain/evaluation';
import { recommendWeakTopics, weakAnglesOf } from '../domain/learner';
import { knowledgeById } from '../domain/knowledge';
import type { InterviewAgentSession } from './types';

/** 工具依赖：题库、用户画像、评分用的 LLMProvider、共享会话。 */
export interface AgentToolDeps {
  bank: Question[];
  profile: LearnerProfile;
  provider: LLMProvider;
  session: InterviewAgentSession;
  /** 是否允许生成开放题（对应 AIConfig.generateOpenQuestions 全局开关）；默认 false（与全局 AIConfig 一致）。 */
  generateOpenQuestions?: boolean;
}

/** 统一的文本型工具结果构造器。 */
function textResult<T>(content: string,  details: T, terminate = false): AgentToolResult<T> {
  return {
    content: [{ type: 'text', text: content }],
    details,
    terminate,
  };
}

/**
 * 判断作答是否为空（未作答）：undefined / null / 空串 / 空数组。
 *
 * 为什么集中一处而非散落的 `!answer`：作答结构有两种（选择题 number[]、开放题 string），
 * 各自「空」的语义不同；评分、出题、摘要都需复用同一判空规则，集中定义可避免到处写不一致的判断、
 * 也不会把「空数组」误判成「已作答」（否则会被记成 0 分污染画像）。
 */
function isAnswerEmpty(answer: AnswerValue | undefined): boolean {
  if (answer === undefined || answer === null) return true;
  if (typeof answer === 'string') return answer.trim() === '';
  if (Array.isArray(answer)) return answer.length === 0;
  return false;
}

// ── 参数 schema（TypeBox） ───────────────────────────────
const SearchQuestionsSchema = Type.Object({
  topic: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});
const GetQuestionSchema = Type.Object({
  id: Type.String(),
  format: Type.Optional(Type.Union([Type.Literal('choice'), Type.Literal('open')])),
});
const EvaluateAnswerSchema = Type.Object({});
const GetUserWeaknessesSchema = Type.Object({});
const FinishInterviewSchema = Type.Object({});

type SearchQuestionsParams = {
  topic?: string;
  limit?: number;
};
type GetQuestionParams = {
  id: string;
  format?: 'choice' | 'open';
};

/** 由题目构造工具返回的精简摘要（不含题干全文，避免上下文膨胀）。 */
function toSummary(q: Question, generateOpenQuestions: boolean) {
  const formats = availableFormats(q, generateOpenQuestions ? [] : ['choice']);
  return {
    id: q.id,
    category: q.category,
    topic: q.topic,
    difficulty: q.difficulty,
    formats,
  };
}

/**
 * 评估「当前题」的用户作答（与 evaluateAnswer 工具共用，便于兜底模式复用）：
 * 选择题走确定性 gradeChoice；开放题委托 LLMProvider.evaluateOpenAnswer。
 * 开放题评分失败（无 key / 网络）会向上抛错，调用方决定是记 null 还是提示。
 * 未作答（空 answer）直接返回 null，避免把「没答」误记为 0 分污染成绩与画像。
 */
export async function evaluateSessionQuestion(
  sq: SessionQuestion,
  answer: AnswerValue | undefined,
  provider: LLMProvider,
): Promise<EvaluationResult | null> {
  if (isAnswerEmpty(answer)) return null; // 未作答 → 跳过评分
  // 题目级权重覆盖已随 rubric 字段一并移除（ADR-044），一律使用全局默认权重
  const baseRubric = DEFAULT_RUBRIC;
  if (sq.format === 'choice') {
    const cf = sq.question.formats.choice!;
    const selected = Array.isArray(answer) ? (answer as number[]) : [];
    return gradeChoice(cf, selected, baseRubric);
  }
  const open = sq.question.formats.open!;
  const userAnswer = typeof answer === 'string' ? answer : '';
  return provider.evaluateOpenAnswer(sq.question, open, userAnswer, baseRubric);
}

/**
 * 创建 Agent 工具集（最小垂直切片）。
 *
 * 每个工具的 execute 都是「薄包装」：读 session / 调 domain，再写回 session，返回可读结果。
 *
 * 设计要点（为什么薄）：
 * - 业务决策交给 Agent（选哪题、何时结束），确定性执行（选题、判分、读画像）交给工具，
 *   避免 LLM 自创打分逻辑导致「同分不同判」的不一致；评分口径始终来自 domain/evaluation。
 * - 真正「不确定的」部分留给 Agent，工具层只做只读/写入与受控副作用，便于测试与审计。
 * - session 作为共享可变状态：工具把结论写回 session，UI 通过 handlers 感知变更，形成「Agent 决策 + 工具落地」的闭环。
 */
export function createAgentTools(deps: AgentToolDeps): AgentTool<any>[] {
  const { bank, profile, provider, session, generateOpenQuestions = false } = deps;
  const byId = new Map(bank.map((q) => [q.id, q]));

  const searchQuestions: AgentTool<typeof SearchQuestionsSchema> = {
    name: 'searchQuestions',
    label: '搜索题目',
    description: '按主题或类目筛选题库，返回候选题的精简摘要（id / 类目 / 主题 / 难度 / 可用题型）。用于决定本轮考察哪道题。',
    parameters: SearchQuestionsSchema,
    execute: async (_id, params: SearchQuestionsParams) => {
      let pool = bank;
      if (params.topic) {
        pool = pool.filter((q) => q.topic === params.topic || q.category === params.topic);
      }
      const items = pool.slice(0, params.limit ?? 10).map((q) => toSummary(q, generateOpenQuestions));
      session.log.push({
        at: Date.now(),
        kind: 'tool',
        tool: 'searchQuestions',
        summary: `返回 ${items.length} 道候选`,
        details: { count: items.length },
      });
      return textResult(`找到 ${items.length} 道候选题`, items);
    },
  };

  const getQuestion: AgentTool<typeof GetQuestionSchema> = {
    name: 'getQuestion',
    label: '选定题目',
    description: '按题目 id 把某道题置为「当前题」并呈现给用户。可选 format 指定本次呈现形态（choice/open），缺省按题目可用形态优先 choice。若传入的是 topic/category 而非题号，则退化为该范围下一道未问的题。',
    parameters: GetQuestionSchema,
    execute: async (_id, params: GetQuestionParams) => {
      let q = byId.get(params.id);
      let matchedBy: 'id' | 'topic' = 'id';
      if (!q) {
        // 容错（修复 D）：LLM 可能把 topic/category 当题号传入——退化为该范围下一道未问的题，避免 not_found 致卡死
        const byTopic = bank.filter((x) => x.topic === params.id || x.category === params.id);
        const unasked = byTopic.filter(
          (x) => !session.answers[x.id] && !session.evaluations[x.id] && session.currentQuestion?.question.id !== x.id,
        );
        q = unasked[0] ?? byTopic[0];
        if (q) matchedBy = 'topic';
      }
      if (!q) {
        session.log.push({ at: Date.now(), kind: 'tool', tool: 'getQuestion', summary: `未找到 ${params.id}`, details: { id: params.id } });
        return textResult(`未找到题目 ${params.id}（请使用 searchQuestions 返回的真实题号）`, { error: 'not_found', id: params.id });
      }
      // 尊重全局「生成开放题」开关：关闭时只允许选择题，纯开放题不交付（避免绕过 generateOpenQuestions）。
      const available = availableFormats(q, generateOpenQuestions ? [] : ['choice']);
      if (available.length === 0) {
        session.log.push({
          at: Date.now(),
          kind: 'tool',
          tool: 'getQuestion',
          summary: `题目 ${q.id} 不可用作（开放题已禁用）`,
          details: { id: q.id, reason: 'open_disabled' },
        });
        return textResult(
          `题目 ${q.id} 仅支持开放题，但「生成开放题」开关已关闭，无法呈现。请用 searchQuestions 选择其他题型，或开启该开关。`,
          { error: 'open_disabled', id: q.id },
        );
      }
      const fmt =
        params.format && available.includes(params.format)
          ? params.format
          : available[0];
      const sq: SessionQuestion = { question: q, format: fmt };
      session.currentQuestion = sq;
      session.log.push({
        at: Date.now(),
        kind: 'tool',
        tool: 'getQuestion',
        summary: `选题 ${q.id}（${fmt}）`,
        details: { id: q.id, format: fmt, matchedBy },
      });
      return textResult(
        `已选定题目 ${q.id}（${fmt}）${matchedBy === 'topic' ? '（按主题匹配）' : ''}，请呈现给用户`,
        { id: q.id, format: fmt, matchedBy },
      );
    },
  };

  const evaluateAnswer: AgentTool<typeof EvaluateAnswerSchema> = {
    name: 'evaluateAnswer',
    label: '评估作答',
    description: '评估「当前题」的用户作答：选择题走确定性判分；开放题交给 LLM 评分（四维 rubric）。结果写入会话 evaluations，并原样返回 EvaluationResult（综合分/维度/优势/薄弱/gap）。不要自己打分。',
    parameters: EvaluateAnswerSchema,
    execute: async () => {
      const sq = session.currentQuestion;
      if (!sq) {
        session.log.push({ at: Date.now(), kind: 'tool', tool: 'evaluateAnswer', summary: '无当前题', details: { error: 'no_current_question' } });
        return textResult('当前没有进行中的题目，无法评估', { error: 'no_current_question' });
      }
      const qid = sq.question.id;
      try {
        const result = await evaluateSessionQuestion(sq, session.answers[qid], provider);
        if (result === null) {
          // 未作答：跳过评分，不写虚假 0 分（与评估失败同样记为 null，不计入均分）
          session.evaluations[qid] = null;
          session.log.push({
            at: Date.now(),
            kind: 'tool',
            tool: 'evaluateAnswer',
            summary: '未作答，跳过评分',
            details: { id: qid, skipped: true },
          });
          return textResult('当前题尚未作答，已跳过评分（不会计入成绩）。请先提交作答再评估。', { skipped: true });
        }
        session.evaluations[qid] = result;
        session.log.push({
          at: Date.now(),
          kind: 'tool',
          tool: 'evaluateAnswer',
          summary: `评分 ${result.overall} 分`,
          details: { id: qid, overall: <number>result.overall },
        });
        return textResult(`评估完成：综合 ${result.overall} 分`, result);
      } catch (err) {
        session.evaluations[qid] = null;
        session.log.push({ at: Date.now(), kind: 'tool', tool: 'evaluateAnswer', summary: '评估失败', details: { error: String(err) } });
        return textResult('评估失败（开放题评分缺少可用引擎）', { error: 'evaluation_failed' });
      }
    },
  };

  const getUserWeaknesses: AgentTool<typeof GetUserWeaknessesSchema> = {
    name: 'getUserWeaknesses',
    label: '读取薄弱主题',
    description: '读取用户已练主题的薄弱点（掌握度 < 阈值），作为选题与追问的上下文。只读，不修改画像。',
    parameters: GetUserWeaknessesSchema,
    execute: async () => {
      const weak = recommendWeakTopics(profile, 3);
      session.log.push({
        at: Date.now(),
        kind: 'tool',
        tool: 'getUserWeaknesses',
        summary: `薄弱：${weak.join('、') || '（暂无）'}`,
        details: { weakTopics: weak },
      });
      return textResult(`薄弱主题：${weak.join('、') || '（暂无）'}`, { weakTopics: weak });
    },
  };

  const GetWeakAnglesSchema = Type.Object({
    topic: Type.String({ description: '要查询的 topic id' }),
  });
  const getWeakAngles: AgentTool<typeof GetWeakAnglesSchema> = {
    name: 'getWeakAngles',
    label: '读取薄弱角度',
    description: '读取某 topic 下证据最薄弱的角度列表（基于 angleCoverage），用于“弱 concept → 缺证据 angle”的追问。',
    parameters: GetWeakAnglesSchema,
    execute: async (_id, params: { topic: string }) => {
      const node = knowledgeById(params.topic);
      const expected = node?.angles ?? [];
      const weak = weakAnglesOf(profile, params.topic, expected as any);
      session.log.push({
        at: Date.now(),
        kind: 'tool',
        tool: 'getWeakAngles',
        summary: `角度薄弱：${weak.join('、') || '（无）'}`,
        details: { topic: params.topic, weakAngles: weak, expected },
      });
      return textResult(`主题 ${params.topic} 的薄弱角度：${weak.join('、') || '（暂无）'}`, { topic: params.topic, weakAngles: weak, expected });
    },
  };

  const GetCoverageGapsSchema = Type.Object({});
  const getCoverageGaps: AgentTool<typeof GetCoverageGapsSchema> = {
    name: 'getCoverageGaps',
    label: '读取覆盖缺口',
    description: '读取当前题库的覆盖缺口（未练或前置未掌握的 topic），用于全局选题与补漏。',
    parameters: GetCoverageGapsSchema,
    execute: async () => {
      // 覆盖缺口需基于题库的 topicRefs；此处返回通用提示，实际由调用方聚合
      const weak = recommendWeakTopics(profile, 5);
      return textResult(`覆盖缺口（薄弱优先）：${weak.join('、') || '（暂无）'}`, { weakTopics: weak });
    },
  };

  const finishInterview: AgentTool<typeof FinishInterviewSchema> = {
    name: 'finishInterview',
    label: '结束面试',
    description: '结束本轮面试：置会话状态为 finished，返回本轮摘要（已评题数、综合均分）。当达到题数上限或候选明显不会时应调用。',
    parameters: FinishInterviewSchema,
    execute: async () => {
      session.status = 'finished';
      const questionsAsked = Object.keys(session.evaluations).length;
      const overall = Object.values(session.evaluations)
        .filter((e): e is EvaluationResult => e != null)
        .reduce((a, e, _i, arr) => a + e.overall / arr.length, 0);
      const summary = {
        questionsAsked,
        overall: Math.round(overall),
      };
      session.log.push({ at: Date.now(), kind: 'tool', tool: 'finishInterview', summary: '结束面试', details: summary });
      return textResult('面试结束。', summary);
    },
  };

  return [searchQuestions, getQuestion, evaluateAnswer, getUserWeaknesses, getWeakAngles, getCoverageGaps, finishInterview];
}
