import { describe, expect, it } from 'vitest';
import baseQuestions from './questions/campus-employment-300.json';
import advancedQuestions from './questions/campus-employment-200-2025-2026.json';
import practiceQuestions from './questions/campus-employment-150-foundation-intermediate.json';
import knowledge from './knowledge/campus-employment.json';
import { questionSchema } from '../schemas/question';
import { LEARNING_TRACKS, CAMPUS_EMPLOYMENT_COURSE_TOPICS } from './learningTracks';
import { knowledgeForTrack, questionBankForTrack } from '../domain/learningTracks';
import { knowledgeNodes } from './knowledgeMap';
import { questionBank } from './questionBank';

const allQuestions = [...baseQuestions, ...advancedQuestions, ...practiceQuestions];
const courseQuestions = questionBank.questions.filter((q) => q.courseId === 'campus-employment');
const companyQuestions = courseQuestions.filter((q) => q.id.startsWith('ce-company-'));

describe('campus employment interview course', () => {
  it('registers as an independent learning track with 15 course themes', () => {
    const track = LEARNING_TRACKS.find((item) => item.id === 'campus-employment');
    expect(track?.topicCount).toBe(CAMPUS_EMPLOYMENT_COURSE_TOPICS.length);
    expect(CAMPUS_EMPLOYMENT_COURSE_TOPICS).toHaveLength(15);
    expect(LEARNING_TRACKS.map((item) => item.id)).toContain('campus-employment');
    expect(knowledgeForTrack(knowledgeNodes, 'campus-employment')).toHaveLength(15);
    expect(questionBankForTrack(questionBank, 'campus-employment').questions).toHaveLength(785);
    expect(courseQuestions).toHaveLength(785);
    expect(companyQuestions).toHaveLength(135);
  });

  it('contains the 300-question foundation, 200-question 2025-2026 expansion, and 150-question practice expansion', () => {
    expect(knowledge).toHaveLength(15);
    expect(baseQuestions).toHaveLength(300);
    expect(advancedQuestions).toHaveLength(200);
    expect(practiceQuestions).toHaveLength(150);
    expect(baseQuestions.filter((q) => q.difficulty === 'easy')).toHaveLength(180);
    expect(baseQuestions.filter((q) => q.difficulty === 'medium')).toHaveLength(120);
    expect(advancedQuestions.filter((q) => q.difficulty === 'medium')).toHaveLength(100);
    expect(advancedQuestions.filter((q) => q.difficulty === 'hard')).toHaveLength(100);
    expect(practiceQuestions.filter((q) => q.difficulty === 'easy')).toHaveLength(75);
    expect(practiceQuestions.filter((q) => q.difficulty === 'medium')).toHaveLength(75);
    expect(practiceQuestions.every((q) => q.tags.includes('150-question-expansion') && q.tags.includes('practice-extension'))).toBe(true);
    expect(allQuestions).toHaveLength(650);
  });

  it('uses globally unique IDs and links every question to a course knowledge node', () => {
    expect(new Set(allQuestions.map((q) => q.id)).size).toBe(650);
    expect(new Set(courseQuestions.map((q) => q.id)).size).toBe(785);
    const nodeIds = new Set(knowledge.map((node) => node.id));
    expect(allQuestions.every((q) =>
      q.courseId === 'campus-employment' &&
      q.category === 'campus-employment' &&
      nodeIds.has(q.topic) &&
      q.knowledgeId === q.topic
    )).toBe(true);
  });

  it('uses contextual single/multiple-choice questions only; no open-answer items are shipped', () => {
    const single = allQuestions.filter((q) => q.formats.choice?.type === 'single');
    const multiple = allQuestions.filter((q) => q.formats.choice?.type === 'multiple');
    expect(allQuestions.every((q) => Boolean(q.formats.choice) && !q.formats.open)).toBe(true);
    expect(single).toHaveLength(420);
    expect(multiple).toHaveLength(230);
    expect(single.every((q) => q.formats.choice?.answer.length === 1)).toBe(true);
    expect(multiple.every((q) => q.formats.choice?.answer.length === 3)).toBe(true);
    expect(practiceQuestions.filter((q) => q.formats.choice?.type === 'multiple').every((q) => q.question.includes('多选'))).toBe(true);
    for (const [index, node] of knowledge.entries()) {
      const expected = index < 5 ? 16 : 15;
      expect(multiple.filter((q) => q.topic === node.id), `multiple-choice coverage for ${node.id}`).toHaveLength(expected);
    }
    expect(multiple.length / allQuestions.length).toBeCloseTo(230 / 650);
    expect(allQuestions.every((q) => q.formats.choice?.options.length === 4)).toBe(true);
    expect(practiceQuestions.every((q) => q.question.length >= 80 && q.question.includes('面试官'))).toBe(true);
    expect(allQuestions.every((q) => q.tags.includes('scenario-based') && q.tags.some((tag) => tag.startsWith('case-')))).toBe(true);
    expect(allQuestions.every((q) => questionSchema.safeParse(q).success)).toBe(true);
  });


  it('keeps choice-option lengths balanced and distributes answer positions', () => {
    const ordered = [...allQuestions].sort((a, b) => a.id.localeCompare(b.id));
    const singlePositions = [0, 0, 0, 0];
    const multipleDistractorPositions = [0, 0, 0, 0];
    let singleCorrectAtMaximum = 0;
    let singleCorrectUniquelyLongest = 0;
    const optionSetSignatures = new Set<string>();

    for (const question of ordered) {
      const choice = question.formats.choice!;
      const lengths = choice.options.map((option) => [...option].length);
      expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThanOrEqual(1.7);
      expect(new Set(choice.options).size).toBe(4);
      const optionSetSignature = choice.options
        .map((option) => option.replace(/\s/g, '').replace(/[，。；;：:、！？“”‘’]/g, ''))
        .sort()
        .join('|');
      expect(optionSetSignatures.has(optionSetSignature), `reused option set: ${question.id}`).toBe(false);
      optionSetSignatures.add(optionSetSignature);

      const correctLengths = choice.answer.map((index) => lengths[index]);
      const distractorLengths = lengths.filter((_, index) => !choice.answer.includes(index));
      const correctAverage = correctLengths.reduce((sum, value) => sum + value, 0) / correctLengths.length;
      const distractorAverage = distractorLengths.reduce((sum, value) => sum + value, 0) / distractorLengths.length;
      // 12 字符是历史存量的兼容上限；新题/修改题在导入和 CI 中严格限制为 8 字符。
      expect(Math.abs(correctAverage - distractorAverage)).toBeLessThanOrEqual(12);
      // 校招题库本轮已清理正确项平均长度比干扰项高出 8 字符以上的项目。
      expect(correctAverage - distractorAverage).toBeLessThanOrEqual(8);

      if (choice.type === 'single') {
        const longestDistractor = Math.max(...distractorLengths);
        expect(correctLengths[0] - longestDistractor).toBeLessThanOrEqual(4);
        singlePositions[choice.answer[0]] += 1;
        const correctLength = lengths[choice.answer[0]];
        const maximumLength = Math.max(...lengths);
        if (correctLength === maximumLength) {
          singleCorrectAtMaximum += 1;
          if (lengths.filter((value) => value === maximumLength).length === 1) {
            singleCorrectUniquelyLongest += 1;
          }
        }
      } else {
        for (let index = 0; index < 4; index += 1) {
          if (!choice.answer.includes(index)) multipleDistractorPositions[index] += 1;
        }
      }
    }

    expect(singlePositions).toEqual([106, 105, 105, 104]);
    expect(multipleDistractorPositions).toEqual([59, 57, 57, 57]);
    // Aggregate visibility remains; per-question lead/gap checks above are the stronger controls.
    expect(singleCorrectAtMaximum).toBeLessThanOrEqual(130);
    expect(singleCorrectUniquelyLongest).toBeLessThanOrEqual(75);
  });

  it('has traceable 2025-2026 interview patterns and clearly marked practice extensions', () => {
    expect(allQuestions.every((q) => Boolean(q.source?.materialId && q.source.section))).toBe(true);
    expect(allQuestions.some((q) => q.tags.includes('field-reported-2025-2026'))).toBe(true);
    expect(allQuestions.some((q) => q.tags.includes('practice-extension'))).toBe(true);
    expect(advancedQuestions.every((q) => q.tags.includes('2025-2026-expansion'))).toBe(true);
  });

  it('covers all 15 course themes in the 200 new questions', () => {
    const covered = new Set(advancedQuestions.map((q) => knowledge.find((node) => node.id === q.topic)?.topic));
    expect(covered.size).toBe(15);
    for (const node of knowledge) {
      expect(advancedQuestions.some((q) => q.topic === node.id), `no advanced questions for ${node.id}`).toBe(true);
    }
  });
});
