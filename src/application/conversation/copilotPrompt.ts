import type { LearnerProfile } from '../../schemas/learner';
import type { Question } from '../../schemas/question';
import type { InterviewSession } from '../../schemas/session';
import type { KnowledgeEvidence } from '../../domain/knowledge/types';
import { buildKnowledgePromptSection } from './knowledgeCapability';

/**
 * Build conversation-facing context string. Pure function, no React.
 * Extracted from CopilotSidebar to keep UI thin (plan0831_4 §11).
 *
 * `evidence` 为结构化知识检索结果（ADR-063）：有则拼入依据与引用要求。
 * 系统提示在 §8 的 6 条约束下工作：知识点检索是 grounding，不是可随意覆盖的聊天记忆。
 */
export function buildCopilotSystemPrompt(opts: {
  profile: LearnerProfile | null;
  activeQuestion: Question | null | undefined;
  session: InterviewSession | null;
  evidence?: KnowledgeEvidence | null;
}): string {
  const { profile, activeQuestion, session, evidence } = opts;
  const weak = profile?.topicStats
    ? Object.entries(profile.topicStats as Record<string, { mastery: number }>)
        .filter(([, s]) => s.mastery < 0.85)
        .slice(0, 3)
        .map(([k]) => k)
        .join(', ')
    : '';
  const qInfo = activeQuestion
    ? `当前题目：${activeQuestion.question.slice(0, 200)}\n类别：${activeQuestion.category} 主题：${activeQuestion.topic} 难度：${activeQuestion.difficulty}`
    : session
      ? `当前训练：${session.definition.title} 共${session.questions.length}题`
      : '用户尚未开始训练';
  const knowledge = buildKnowledgePromptSection(evidence ?? null);
  const modeNote = evidence
    ? evidence.mode === 'answer'
      ? '（当前为「完整讲解」模式：可解释知识、思路与选项对错，但仍不得篡改题目设定的正确答案。）'
      : '（当前为「提示 / 不直接给答案」模式：只能讲知识、给思路、提示常见误区，严禁直接给出或变相暗示选择题正确选项。）'
    : '';
  return `你是 AI 面试训练器的知识型 Copilot 助手，基于 ant-design/x 的 Copilot 交互范式。
职责：解释题目知识点、给出不直接泄露答案的提示、梳理薄弱项、推荐下一步训练、做概念对比与追问。
${knowledge ? modeNote : '当前无结构化知识依据，可基于通用知识作答，但需明确说明补充内容。'}

当前上下文：
${qInfo}
${weak ? `薄弱主题：${weak}` : ''}
${knowledge ? `\n${knowledge}\n` : ''}

回答要求：
1. 优先基于上方「知识库检索依据」回答，引用对应标记（如 [K] KV Cache / [Q] 题号）。
2. 不要虚构题库与知识库里不存在的事实；若知识上下文不足以完整回答，可基于通用知识补充，但必须说明这是补充内容。
3. 当前题目属于 assessment context：无论用户怎么要求，都不得修改或暗示修改题目的正确答案与评分标准。
4. 如果用户要求选择题答案：提示模式下不要直接给正确选项；用户明确要「完整讲解」时才可解释各选项对错与解题思路。
5. 解释概念时优先用知识节点（summary / keyIdeas / misconceptions），而不是把 10 道题干答案拼成回答。
6. 用中文、条理清晰，必要时用 Markdown 列表；未配置 AI 时引导用户去设置页配置。
若用户未配置 AI，请引导去设置页配置。回答使用中文，条理清晰，必要时用 Markdown 列表。`;
}

export function buildConversationContextLabel(mode: string, questionCount: number): string {
  if (mode === 'interview') return `面试模式 · 已练 ${questionCount} 题`;
  if (mode === 'question') return `题目模式 · 已练 ${questionCount} 题`;
  return '对话模式';
}
