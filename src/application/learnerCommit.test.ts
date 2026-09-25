// 画像提交队列：把「读-改-写」整体串行化，消除并发覆盖（丢更新）。
//
// 丢更新的特征是「先完成的那次成绩静默消失」——没有任何报错，进度页只是少了一条记录。
// 故这里既断言最终画像（两次提交都在），也断言落库顺序（恒等于调用顺序）。

import { describe, it, expect } from 'vitest';
import type { LearnerProfile } from '../schemas/learner';
import { createLearnerCommitter } from './learnerCommit';

/** 用「会话标题列表」当作画像的可见内容，便于断言两次提交是否都落了进去。 */
function profileWith(titles: string[]): LearnerProfile {
  return { sessions: titles.map((title) => ({ title })) } as unknown as LearnerProfile;
}

function titles(p: LearnerProfile): string[] {
  return p.sessions.map((s) => s.title ?? '');
}

/** 造一个提交器；`persistDelayMs` 用来让两次提交真正交错（暴露「入队前读基准」的丢更新）。 */
function setup(persistDelayMs = 0) {
  let current = profileWith([]);
  const saved: string[][] = [];
  const commit = createLearnerCommitter({
    read: () => current,
    write: (next) => {
      current = next;
    },
    save: async (next) => {
      if (persistDelayMs) await new Promise((r) => setTimeout(r, persistDelayMs));
      saved.push(titles(next));
    },
  });
  const add = (title: string) => commit((base) => profileWith([...titles(base), title]));
  return { add, saved, current: () => current };
}

describe('createLearnerCommitter', () => {
  it('并发提交不丢更新：两次「读-改-写」都体现在最终画像里', async () => {
    const { add, current } = setup(5);
    await Promise.all([add('训练 A'), add('面试 B')]);
    expect(titles(current())).toEqual(['训练 A', '面试 B']);
  });

  it('基准在临界区内读取：第二次提交看到第一次的结果', async () => {
    const { add, saved } = setup(5);
    await Promise.all([add('A'), add('B')]);
    expect(saved).toEqual([['A'], ['A', 'B']]);
  });

  it('落库顺序恒等于调用顺序（先调用的先写入，即便它更慢）', async () => {
    const order: string[] = [];
    let current = profileWith([]);
    const commit = createLearnerCommitter({
      read: () => current,
      write: (next) => {
        current = next;
      },
      save: async (next) => {
        const last = titles(next)[titles(next).length - 1];
        // 第一次写入反而更慢：未串行化时它会在后面完成，用旧快照覆盖掉第二次的结果
        await new Promise((r) => setTimeout(r, last === 'first' ? 10 : 0));
        order.push(last);
      },
    });
    await Promise.all([
      commit((b) => profileWith([...titles(b), 'first'])),
      commit((b) => profileWith([...titles(b), 'second'])),
    ]);
    expect(order).toEqual(['first', 'second']);
    expect(titles(current)).toEqual(['first', 'second']);
  });

  it('一次提交失败：原样抛给本次调用方，但不阻塞后续提交', async () => {
    let current = profileWith([]);
    let failNext = true;
    const commit = createLearnerCommitter({
      read: () => current,
      write: (next) => {
        current = next;
      },
      save: async () => {
        if (failNext) {
          failNext = false;
          throw new Error('QuotaExceededError');
        }
      },
    });
    const bad = commit((b) => profileWith([...titles(b), 'bad']));
    const good = commit((b) => profileWith([...titles(b), 'good']));

    await expect(bad).rejects.toThrow('QuotaExceededError');
    await expect(good).resolves.toBeDefined();
    // 失败的提交没有写回基准，故第二次提交基于「空画像」——这正是「失败不入账」的语义
    expect(titles(current)).toEqual(['good']);
  });

  it('提交后同步写回基准：无需等待 React 重渲染，下一次提交立刻可见', async () => {
    const { add, current } = setup(0);
    const first = add('A');
    // 不 await：写回必须是同步的，否则这里读到的还是空画像
    expect(titles(current())).toEqual([]);
    await first;
    expect(titles(current())).toEqual(['A']);
  });
});
