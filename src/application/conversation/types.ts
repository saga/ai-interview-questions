import type { LLMProvider, QuestionBank } from '../../types';
import type { AIConfig } from '../../schemas/ai-config';
import type { FormatId } from '../../schemas/common';
import type { LearnerProfile } from '../../schemas/learner';
import type { Question } from '../../schemas/question';

export interface ConversationDeps {
  bank: QuestionBank;
  profile: LearnerProfile;
  config?: AIConfig;
  provider?: LLMProvider | null;
}

export interface AskQuestionInput {
  topic?: string;
  difficulty?: Question['difficulty'];
  format?: FormatId;
  excludeIds?: string[];
}
