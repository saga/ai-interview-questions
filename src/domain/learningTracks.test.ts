import { describe, expect, it } from 'vitest';
import type { Question } from '../schemas/question';
import { courseTopicIds, profileForTrack, questionsForKnowledgeNode } from './learningTracks';
import { emptyProfile } from './learner';
import { knowledgeNodes } from '../data/knowledgeMap';

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
      question('node-a-q1', 'node-a', 'node-a'),
      question('node-b-q1', 'node-b', 'node-b'),
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
      question('node-b-q1', 'node-b', 'node-b'),
    ], 'node-a')).toEqual([]);
  });
});

describe('course learner profile projection', () => {
  it('keeps both exact node IDs and shared parent topics in course progress keys', () => {
    const snowflakeNode = knowledgeNodes.find((node) => node.id === 'snowflake-architecture');
    expect(snowflakeNode).toBeDefined();
    const keys = courseTopicIds('snowflake');
    expect(keys.has('snowflake-architecture')).toBe(true);
    expect(keys.has(snowflakeNode!.topic)).toBe(true);

    const profile = emptyProfile();
    const stat = {
      attempts: 1, avgScore: 80, lastScore: 80, mastery: 0.8,
      trend: 'stable', commonWeaknesses: [], lastSeen: 1,
    } as const;
    profile.topicStats['snowflake-architecture'] = stat;
    profile.topicStats[snowflakeNode!.topic] = stat;
    const projected = profileForTrack(profile, 'snowflake', [snowflakeNode!]);
    expect(projected.topicStats['snowflake-architecture']).toBeDefined();
    expect(projected.topicStats[snowflakeNode!.topic]).toBeDefined();
  });
});
