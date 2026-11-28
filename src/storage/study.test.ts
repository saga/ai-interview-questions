import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { getStudyProgress, markArticleCompleted, recordArticleOpened } from './study';

describe('storage/study', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('记录打开的文章，但不将其算作已完成', async () => {
    await recordArticleOpened('snowflake', 'snowflake-architecture', 'architecture-core');
    const rows = await getStudyProgress('snowflake');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      nodeId: 'snowflake-architecture',
      lastArticleId: 'architecture-core',
      completedArticleIds: [],
    });
  });

  it('完成文章去重，并保留最后阅读位置', async () => {
    await markArticleCompleted('snowflake', 'snowflake-architecture', 'architecture-core');
    await markArticleCompleted('snowflake', 'snowflake-architecture', 'architecture-core');
    await recordArticleOpened('snowflake', 'snowflake-architecture', 'architecture-core');
    const [row] = await getStudyProgress('snowflake');
    expect(row.completedArticleIds).toEqual(['architecture-core']);
    expect(row.lastArticleId).toBe('architecture-core');
  });

  it('课程之间的学习记录相互隔离', async () => {
    await markArticleCompleted('snowflake', 'same-node', 'article-1');
    await markArticleCompleted('ai', 'same-node', 'article-2');
    expect((await getStudyProgress('snowflake')).map((row) => row.completedArticleIds)).toEqual([['article-1']]);
    expect((await getStudyProgress('ai')).map((row) => row.completedArticleIds)).toEqual([['article-2']]);
  });
});
