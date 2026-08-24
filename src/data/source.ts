// QuestionSource：题库的抽象来源（前瞻接口，为未来 Course Question Bank 预留接缝）。
//
// 设计意图（与"Course → Course Question Bank 独立生产管线"提案一致）：
// - 当前只有 Interview Trainer 一个来源；未来的课程题库实现同一接口即可接入，
//   而引擎（interviewEngine.buildSession / nextAdaptiveStep）与 Agent 工具层
//   已经按 QuestionBank / Question[] 参数化，无需改动即可消费新来源。
// - Interview 与 Course 不共享 taxonomy / blueprint / adaptive policy（各自独立），
//   但共享底层基础设施：Zod 校验、Question schema、embedding 去重、learner evidence、
//   IndexedDB、LLM provider、QuestionSource 抽象本身。
//
// 红线：课程题库必须放在 src/data/courses/<courseId>/ 下（见 ARCHITECTURE.md），
// 不能被 src/data/questionBank.ts 的 import.meta.glob('./questions/*.json') 误收，
// 也不能污染 Interview Trainer 的 domain taxonomy。

import type { Question, QuestionBank } from '../types';
import { questionBank } from './questionBank';

/** 题库抽象来源：一个可被引擎 / Agent / UI 消费的题集。 */
export interface QuestionSource {
  /** 稳定 id：'interview' 或 'course:<courseId>'。 */
  readonly id: string;
  /** 展示名（UI 导航用）。 */
  readonly label: string;
  /** 该来源的全部题目（装配期已通过 Zod 形状校验）。 */
  getQuestions(): Question[];
}

/** Interview Trainer 来源：包装既有 questionBank 单例，向后兼容现有消费者。 */
export const interviewQuestionSource: QuestionSource = {
  id: 'interview',
  label: 'Interview Trainer',
  getQuestions: () => questionBank.questions,
};

/** 全部已注册来源。未来 Course 来源在此追加即可，无需改动引擎 / Agent。 */
export const questionSources: QuestionSource[] = [interviewQuestionSource];

export function getQuestionSource(id: string): QuestionSource | undefined {
  return questionSources.find((s) => s.id === id);
}

export function listQuestionSources(): QuestionSource[] {
  return questionSources;
}

export function allQuestions(): Question[] {
  return questionSources.flatMap((s) => s.getQuestions());
}

/**
 * 由来源构造引擎所需 QuestionBank：category 取自题面（课程来源会把 category 设为 courseId），
 * 故引擎的 categories / questions 过滤逻辑对两种来源一视同仁。
 */
export function sourceToBank(source: QuestionSource): QuestionBank {
  const questions = source.getQuestions();
  return {
    categories: [...new Set(questions.map((q) => q.category))],
    questions,
  };
}
