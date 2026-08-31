import type { LearnerProfile } from '../../schemas/learner';
import type { Question } from '../../schemas/question';
import type { InterviewSession } from '../../schemas/session';

/**
 * Build conversation-facing context string. Pure function, no React.
 * Extracted from CopilotSidebar to keep UI thin (plan0831_4 §11).
 */
export function buildCopilotSystemPrompt(opts: {
  profile: LearnerProfile | null;
  activeQuestion: Question | null | undefined;
  session: InterviewSession | null;
}): string {
  const { profile, activeQuestion, session } = opts;
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
  return `你是 AI 面试训练器的 Copilot 侧边助手，基于 ant-design/x 的 Copilot 交互范式。
职责：解释题目知识点、给出不直接泄露答案的提示、梳理薄弱项、推荐下一步训练。严禁直接替用户作答选择题的正确选项，可引导思考。
当前上下文：
${qInfo}
${weak ? `薄弱主题：${weak}` : ''}
若用户未配置 AI，请引导去设置页配置。回答使用中文，条理清晰，必要时用 Markdown 列表。`;
}

export function buildConversationContextLabel(mode: string, questionCount: number): string {
  if (mode === 'interview') return `面试模式 · 已练 ${questionCount} 题`;
  if (mode === 'question') return `题目模式 · 已练 ${questionCount} 题`;
  return '对话模式';
}
