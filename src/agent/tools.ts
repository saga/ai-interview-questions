// Agent 工具层：把现有 domain / learner / evaluation / ai 能力包装成 pi-agent-core 的 AgentTool。
// 设计红线（对齐 AGENTS.md 与计划）：
// - 工具只做「确定性执行」，不含业务决策；Agent 负责决策；
// - 评分委托现有逻辑：选择题 → gradeChoice（无 LLM），开放题 → LLMProvider.evaluateOpenAnswer；
//   Agent 只读取 EvaluationResult，绝不自己打分；
// - 工具参数 schema 用 TypeBox（pi-agent-core 要求），与项目既有 Zod 不冲突。

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { LLMProvider } from '../types';
import type { EvaluationResult } from '../schemas/evaluation';
import type { LearnerProfile } from '../schemas/learner';
import type { Question } from '../schemas/question';
import { availableSessionFormats, evaluateSessionQuestion, finalizeQuestion } from '../application/sessionEvaluator';
import { collectTopicRefs, describeCoverageGap, findCoverageGaps, recommendWeakTopics, weakAnglesOf } from '../domain/learner';
import { knowledgeById } from '../domain/knowledge';
import type { InterviewAgentSession } from './types';

/** 工具依赖：题库、用户画像、评分用的 LLMProvider、共享会话。 */
export interface AgentToolDeps {
  bank: Question[];
  profile: LearnerProfile;
  provider: LLMProvider | null;
  session: InterviewAgentSession;
  /** 是否允许生成开放题（对应 AIConfig.generateOpenQuestions 全局开关）；默认 false（与全局 AIConfig 一致）。 */
  generateOpenQuestions?: boolean;
  /** 主题达标线（0-100）；默认 75。 */
  masteryThreshold?: number;
  disabledCategories?: string[];
}

/** 统一的文本型工具结果构造器。 */
function textResult<T>(content: string,  details: T, terminate = false): AgentToolResult<T> {
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
function toSummary(q: Question, generateOpenQuestions: boolean) {
  const formats = availableSessionFormats(q, undefined, true, generateOpenQuestions);
  return {
    id: q.id,
    category: q.category,
    topic: q.topic,
    difficulty: q.difficulty,
    formats,
  };
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
/**
 * 「已交付过」判定：已作答、已评分、或正是当前题——三者任一成立都不得再次交付，
 * 否则用户会重复看到同一道题。
 *
 * 用 `in` 而非真值判断是刻意的：`evaluations[id]` 可以是 null（未作答 / 评估失败被记为 null），
 * 但那道题确实已经呈现给用户了，口径与 `countEvaluated` 保持一致。
 */
function isDelivered(session: InterviewAgentSession, id: string): boolean {
  return id in session.answers || id in session.evaluations || session.currentQuestion?.question.id === id;
}

/**
 * 可交付题号池：优先「最近一次 searchQuestions 返回的真实 id」，否则退回全题库；
 * 两种来源都只保留**本轮尚未交付过**、且确实存在于题库中的 id。
 *
 * 作为 getQuestion 做 id 校验与自纠正（not_found / topic_exhausted）的唯一可信来源——
 * 让 Agent 无需记忆即可挑到真 id，把「回到列表挑真 id / 不要编造」从 prompt 约束下沉为确定性行为。
 * 过滤掉已交付的题，是为了避免自纠正又把 Agent 指回刚问过的题。
 */
function deliverableIds(session: InterviewAgentSession, byId: Map<string, Question>): string[] {
  const pool = session.lastSearchIds.length ? session.lastSearchIds : Array.from(byId.keys());
  return pool.filter((id) => byId.has(id) && !isDelivered(session, id));
}

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
      const ids = items.map((it) => it.id);
      // 幂等判定：与「最近一次搜索结果」完全一致视为重复调用——直接复用缓存列表，
      // 从代码层消除「反复调用 searchQuestions」动机（原 prompt 约束由此下沉为确定性行为）。
      const isRepeat =
        session.lastSearchIds.length > 0 &&
        ids.length > 0 &&
        ids.length === session.lastSearchIds.length &&
        ids.every((id, i) => id === session.lastSearchIds[i]);
      // 写入「最近一次搜索结果」：getQuestion 的 id 校验 / not_found 自纠正的唯一可信池。
      session.lastSearchIds = ids;
      // 关键修复：候选的真实 id 必须写进 content 文本（LLM 只能读到 content，看不到 details），
      // 否则 LLM 拿不到题号、只能反复猜测 id 导致卡死。
      const list = items
        .map(
          (it, i) =>
            `${i + 1}. id=${it.id} | topic=${it.topic} | category=${it.category} | difficulty=${it.difficulty} | formats=${it.formats.join('/')}`,
        )
        .join('\n');
      const nextStep =
        '下一步：从这些候选里选 1 道（建议从薄弱主题 / 难度适中开始），调用 getQuestion(id=<上面列出的真实 id>) 呈现给用户。';
      const content =
        items.length > 0
          ? isRepeat
            ? `（检测到重复调用 searchQuestions，已复用上次的候选列表，无需再次调用）\n${list}\n\n${nextStep}`
            : `找到 ${items.length} 道候选题（按顺序排列，请用其中真实 id 调用 getQuestion）：\n${list}\n\n${nextStep}`
          : `未找到匹配「${params.topic ?? '全部'}」的候选题。请换一个 topic / category，或不带参数重新 searchQuestions 获取全部候选。`;
      session.log.push({
        at: Date.now(),
        kind: 'tool',
        tool: 'searchQuestions',
        summary: `返回 ${items.length} 道候选`,
        details: { count: items.length, repeat: isRepeat },
      });
      return textResult(content, items);
    },
  };

  const getQuestion: AgentTool<typeof GetQuestionSchema> = {
    name: 'getQuestion',
    label: '选定题目',
    description: '按题目 id 把某道题置为「当前题」并呈现给用户。可选 format 指定本次呈现形态（choice/open），缺省按题目可用形态优先 choice。若传入的是 topic/category 而非题号，则退化为该范围内一道尚未考察过的题；该范围已全部考察过时会返回 topic_exhausted 并列出其它未考察题号供你另选，绝不重复出已考察过的题。',
    parameters: GetQuestionSchema,
    execute: async (_id, params: GetQuestionParams) => {
      let q = byId.get(params.id);
      let matchedBy: 'id' | 'topic' = 'id';
      let exhaustedTopic = false;
      if (!q) {
        // 容错（修复 D）：LLM 可能把 topic/category 当题号传入——退化为该范围下一道未交付的题，避免 not_found 致卡死。
        const byTopic = bank.filter((x) => x.topic === params.id || x.category === params.id);
        q = byTopic.find((x) => !isDelivered(session, x.id));
        if (q) {
          matchedBy = 'topic';
        } else {
          // 该主题已全部考察过：**绝不**回退到已交付的题（否则用户会重复看到同一道题）。
          // 换去哪个主题是业务决策，交给 Agent——工具只负责回带「尚未交付」的题号。
          exhaustedTopic = byTopic.length > 0;
        }
      }
      if (!q) {
        // 自纠正：把可用题号直接回带，Agent 无需记忆即可挑真 id——
        // 替代原 prompt「若 not_found 就回到 searchQuestions 列表挑真 id」的脆弱约束（确定性、不依赖 LLM 听话）。
        // 只回带未交付的题，避免 Agent 按提示又挑到刚问过的题。
        const reason = exhaustedTopic ? 'topic_exhausted' : 'not_found';
        const validIds = deliverableIds(session, byId);
        const hint = validIds.length
          ? `\n可用题号（本轮尚未考察过，请直接挑其中一个传入）：\n${validIds.map((id, i) => `${i + 1}. id=${id}`).join('\n')}`
          : '\n题库中所有题目本轮均已考察过，没有可继续出的题了——请调用 finishInterview 结束面试。';
        const message = exhaustedTopic
          ? `主题「${params.id}」的题目本轮已全部考察过，为避免重复出题不再从中选题。`
          : `未找到题目 ${params.id}。`;
        session.log.push({
          at: Date.now(),
          kind: 'tool',
          tool: 'getQuestion',
          summary: exhaustedTopic ? `${params.id} 已考察完` : `未找到 ${params.id}`,
          details: { id: params.id, validIds, reason },
        });
        return textResult(
          `${message}${hint}${validIds.length ? '\n请用上面列出的真实 id 调 getQuestion，不要猜测或编造。' : ''}`,
          { error: reason, id: params.id, validIds },
        );
      }
      // 尊重全局「生成开放题」开关：关闭时只允许选择题，纯开放题不交付（避免绕过 generateOpenQuestions）。
      const available = availableSessionFormats(q, undefined, true, generateOpenQuestions);
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
      const sq = await finalizeQuestion({ question: q, format: fmt }, provider);
      session.currentQuestion = sq;
      session.log.push({
        at: Date.now(),
        kind: 'tool',
        tool: 'getQuestion',
        summary: `选题 ${q.id}（${fmt}）`,
        details: { id: q.id, format: fmt, matchedBy },
      });
      // topic 兜底（修复 D）仍保留以防卡死，但回带正确 id 示例，教 Agent「应直接传真实 id」。
      const topicNote =
        matchedBy === 'topic'
          ? `（提示：你传入的是 topic 而非真实 id，已按主题兜底选 ${q.id}；正确做法是直接用 searchQuestions 返回的真实 id，例如：${deliverableIds(
              session,
              byId,
            )
              .slice(0, 3)
              .join('、')}）`
          : '';
      return textResult(
        `已选定题目 ${q.id}（${fmt}）${topicNote}，请呈现给用户`,
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
      const weak = recommendWeakTopics(profile, 3, deps.masteryThreshold);
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
    // 与 getUserWeaknesses 明确分工：后者回答「已练但薄弱」（掌握度），本工具回答「还没练到」（覆盖度），两者不重叠。
    description: '读取覆盖缺口：题库里有、但用户尚未练习的 topic（uncovered），以及因前置知识未掌握而暂时不该上的 topic（prerequisite）。只读事实，不含建议；与 getUserWeaknesses（已练但薄弱）互补，不要混用。',
    parameters: GetCoverageGapsSchema,
    execute: async () => {
      const gaps = findCoverageGaps(collectTopicRefs(bank), profile, {
        threshold: deps.masteryThreshold,
        limit: 5,
      });
      const content = gaps.length
        ? `覆盖缺口（${gaps.length} 个，前置缺口优先）：\n${gaps
            .map((g) => `- ${g.topic}：${describeCoverageGap(g, profile)}`)
            .join('\n')}`
        : '当前题库中的所有 topic 均已练习且前置完备，没有覆盖缺口。';
      session.log.push({
        at: Date.now(),
        kind: 'tool',
        tool: 'getCoverageGaps',
        summary: `覆盖缺口 ${gaps.length} 个`,
        details: { gaps },
      });
      return textResult(content, { gaps });
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
