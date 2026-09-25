// Learner 画像的「读-改-写」提交队列。
//
// 问题：`updateLearner(profile, record)` 是**读-改-写**。调用点各自持有一份内存快照
// （hook 里的 `profileRef.current`），两个写入入口并发时——典型是「普通训练提交」与
// 「Agent 面试收尾落库」同屏发生——后完成者会用「不含对方结果」的画像整体覆盖，
// 先完成的那次成绩被**静默丢弃**（没有任何报错，进度页只是少了一次记录）。
// `saveLearner` 内部的 Dexie 事务只保证**单次写入原子**，覆盖不了跨调用的读-改-写。
//
// 为什么基准不重新 `loadLearner()` 读库：它不是 `saveLearner` 的逆运算——
// 会用**默认** proficiency 配置重算 mastery（见 storage/learner.ts 的 calculateProficiency 调用）、
// 按 SESSION_CAP 截断会话、丢弃校验不过的行。用它当基准会静默改写用户的掌握度。
// 故队列在临界区内读调用方提供的「最新快照」，并在提交成功后**同步**回写该快照，
// 使下一次提交一定基于上一次的结果。
//
// 不依赖 React / Dexie：读写与落库全部注入，便于单测（见 learnerCommit.test.ts）。

import type { LearnerProfile } from '../schemas/learner';

export interface LearnerCommitterDeps {
  /** 读取当前最新画像快照。**会在临界区内被调用**，故应返回同步可得的引用，而不是发起异步读库。 */
  read: () => LearnerProfile;
  /** 提交成功后同步写回最新画像（供队列中的下一次提交读取）。 */
  write: (next: LearnerProfile) => void;
  /** 落库（通常是 `saveLearner`）。 */
  save: (next: LearnerProfile) => Promise<void>;
}

export type LearnerCommitter = (mutate: (base: LearnerProfile) => LearnerProfile) => Promise<LearnerProfile>;

/**
 * 创建一个串行化的画像提交器：所有提交按调用顺序依次执行
 * 「读基准 → 变换 → 落库 → 回写基准」，彼此不可能交错。
 *
 * @returns `commit(mutate)`：提交一次变换，resolve 为落库后的新画像。
 *   本次落库失败时 reject（调用方需要看到失败并提示用户），
 *   但**不会**影响队列中后续提交——见下方 tail 的说明。
 */
export function createLearnerCommitter(deps: LearnerCommitterDeps): LearnerCommitter {
  const { read, write, save } = deps;
  let tail: Promise<unknown> = Promise.resolve();

  return (mutate) => {
    const run = tail.then(async () => {
      // 基准必须在临界区内读：入队前读到的快照可能已被前一次提交取代（那正是丢更新的成因）。
      const next = mutate(read());
      await save(next);
      // 同步回写，不等 React 重渲染：队列中的下一次提交必须立刻看到这次结果。
      write(next);
      return next;
    });
    // 队尾自己吞掉失败：一次提交失败不得让后续提交全部短路——否则一次 IndexedDB 抖动
    // 会让此后所有成绩都写不进去，而用户只会看到「第一次提交报错、之后静默无效」。
    // 失败仍会原样抛给本次调用方。
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
