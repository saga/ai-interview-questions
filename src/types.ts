export type QuestionType = 'single' | 'multiple' | 'essay';
export type Difficulty = 'easy' | 'medium' | 'hard';

interface QuestionBase {
  id: string;
  category: string;
  difficulty: Difficulty;
  question: string;
  explanation: string;
  aiGenerated?: boolean;
}

export interface ChoiceQuestion extends QuestionBase {
  type: 'single' | 'multiple';
  options: string[];
  /** 正确选项的索引数组。single 长度为 1，multiple 长度为 >=1 */
  answer: number[];
}

export interface EssayQuestion extends QuestionBase {
  type: 'essay';
  referenceAnswer: string;
}

export type Question = ChoiceQuestion | EssayQuestion;

export interface QuestionBank {
  categories: string[];
  questions: Question[];
}

/** 答题状态：选择题存选中的索引数组，问答题存文本 */
export type AnswerValue = number[] | string;

export interface EssayGrade {
  score: number;
  feedback: string;
  strengths: string[];
  missed: string[];
}
