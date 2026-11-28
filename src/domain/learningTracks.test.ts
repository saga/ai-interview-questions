import { describe, expect, it } from 'vitest';
import type { Question } from '../schemas/question';
import { questionsForKnowledgeNode } from './learningTracks';

function question(
  id: string,
  topic: string,
  knowledgeId?: string,
): Question {
  return {
    id,
    category: 'snowflake',
    topic,
    knowledgeId,
    tags: [],
    difficulty: 'easy',
    question: id,
    explanation: '',
    formats: {
      choice: {
        type: 'single',
        options: ['A', 'B', 'C', 'D'],
        answer: [0],
      },
    },
  } as Question;
}

describe('questionsForKnowledgeNode', () => {
  it('selects the explicit KnowledgeNode mapping, not sibling nodes in the same topic', () => {
    const bank = [
      question('node-a-q1', 'snowflake', 'node-a'),
      question('node-b-q1', 'snowflake', 'node-b'),
    ];

    expect(questionsForKnowledgeNode(bank, 'node-a').map((item) => item.id))
      .toEqual(['node-a-q1']);
  });

  it('uses topic=nodeId only for legacy questions without knowledgeId', () => {
    const bank = [
      question('legacy-q1', 'node-a'),
      question('mapped-q1', 'node-a', 'node-b'),
    ];

    expect(questionsForKnowledgeNode(bank, 'node-a').map((item) => item.id))
      .toEqual(['legacy-q1']);
  });

  it('returns an empty list when the node has no mapped questions', () => {
    expect(questionsForKnowledgeNode([
      question('node-b-q1', 'snowflake', 'node-b'),
    ], 'node-a')).toEqual([]);
  });
});
