// Agent 工具层：把现有 domain / learner / evaluation / ai 能力包装成 pi-agent-core 的 AgentTool。
// 设计红线（对齐 AGENTS.md 与计划）：
// - 工具只做「确定性执行」，不含业务决策；Agent 负责决策；
// - 评分委托现有逻辑：选择题 → gradeChoice（无 LLM），开放题 → LLMProvider.evaluateOpenAnswer；
//   Agent 只读取 EvaluationResult，绝不自己打分；
// - 工具参数 schema 用 TypeBox（pi-agent-core 要求），与项目既有 Zod 不冲突。

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { EvaluationResult, LearnerProfile, LLMProvider, Question, SessionQuestion } from '../types';
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
}

/** 统一的文本型工具结果构造器。 */
function textResult<T>(content: string, details: T, terminate = false): AgentToolResult<T> {
  return {
    content: [{ type: 'text', text: content }],
    details,
    terminate,
  };
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
function toSummary(q: Question) {
  const formats = availableFormats(q, []);
  return {
    id: q.id,
    category: q.category,
    topic: q.topic,
    difficulty: q.difficulty,
    formats,
  };
}

/**
 * 创建 Agent 工具集（最小垂直切片：5 个）。
 * 每个工具的 execute 都是「薄包装」：读 session / 调 domain，再写回 session，返回可读结果。
 */
export function createAgentTools(deps: AgentToolDeps): AgentTool<any>[] {
  const { bank, profile, provider, session } = deps;
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
      const items = pool.slice(0, params.limit ?? 10).map(toSummary);
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
    description: '按题目 id 把某道题置为「当前题」并呈现给用户。可选 format 指定本次呈现形态（choice/open），缺省按题目可用形态优先 choice。',
    parameters: GetQuestionSchema,
    execute: async (_id, params: GetQuestionParams) => {
      const q = byId.get(params.id);
      if (!q) {
        session.log.push({ at: Date.now(), kind: 'tool', tool: 'getQuestion', summary: `未找到 ${params.id}`, details: { id: params.id } });
        return textResult(`未找到题目 ${params.id}`, { error: 'not_found', id: params.id });
      }
      const available = availableFormats(q, []);
      const fmt =
        params.format && available.includes(params.format)
          ? params.format
          : available.includes('choice')
            ? 'choice'
            : 'open';
      const sq: SessionQuestion = { question: q, format: fmt };
      session.currentQuestion = sq;
      session.log.push({
        at: Date.now(),
        kind: 'tool',
        tool: 'getQuestion',
        summary: `选题 ${q.id}（${fmt}）`,
        details: { id: q.id, format: fmt },
      });
      return textResult(`已选定题目 ${q.id}（${fmt}），请呈现给用户`, { id: q.id, format: fmt });
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
      const answer = session.answers[qid];
      const baseRubric = sq.question.rubric?.dimensions
        ? { ...DEFAULT_RUBRIC, ...sq.question.rubric.dimensions }
        : DEFAULT_RUBRIC;

      let result: EvaluationResult;
      if (sq.format === 'choice') {
        const cf = sq.question.formats.choice!;
        const selected = Array.isArray(answer) ? (answer as number[]) : [];
        result = gradeChoice(cf, selected, baseRubric);
      } else {
        const open = sq.question.formats.open!;
        const userAnswer = typeof answer === 'string' ? answer : '';
        result = await provider.evaluateOpenAnswer(sq.question, open, userAnswer, baseRubric);
      }
      session.evaluations[qid] = result;
      session.log.push({
        at: Date.now(),
        kind: 'tool',
        tool: 'evaluateAnswer',
        summary: `评分 ${result.overall} 分`,
        details: { id: qid, overall: result.overall },
      });
      return textResult(`评估完成：综合 ${result.overall} 分`, result);
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
