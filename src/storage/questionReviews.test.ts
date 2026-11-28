import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { getDueQuestionReviews, recordQuestionReviewRating } from './questionReviews';

describe('storage/questionReviews', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('按回忆难度设置下次复习时间', async () => {
    const now = 1_800_000_000_000;
    const again = await recordQuestionReviewRating('snowflake', 'dynamic-tables-01', 'again', now);
    expect(again?.dueAt).toBe(now + 10 * 60_000);
    expect(again?.repetitions).toBe(0);

    const good = await recordQuestionReviewRating('snowflake', 'dynamic-tables-01', 'good', now + 11 * 60_000);
    expect(good?.dueAt).toBe(now + 11 * 60_000 + 72 * 60 * 60_000);
    expect(good?.repetitions).toBe(1);
  });

  it('到期队列按课程隔离并优先返回最早到期的题目', async () => {
    const now = 1_800_000_000_000;
    await recordQuestionReviewRating('snowflake', 'q-later', 'again', now - 60 * 60_000);
    await recordQuestionReviewRating('snowflake', 'q-earlier', 'again', now - 2 * 60 * 60_000);
    await recordQuestionReviewRating('sap-it-service-consultant', 'q-other-course', 'again', now - 60 * 60_000);

    const due = await getDueQuestionReviews('snowflake', now, 10);
    expect(due.map((row) => row.questionId)).toEqual(['q-earlier', 'q-later']);
    expect(await getDueQuestionReviews('sap-it-service-consultant', now, 10)).toHaveLength(1);
  });

  it('自评记录不写入学习资料进度或 LearnerProfile', async () => {
    const now = 1_800_000_000_000;
    await recordQuestionReviewRating('snowflake', 'q-1', 'easy', now);
    expect(await db.studyProgress.count()).toBe(0);
    expect(await db.learner.count()).toBe(0);
  });
});
