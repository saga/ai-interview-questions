// 面试收尾的**提交顺序**契约：先落库，成功之后才删除可恢复草稿。
//
// 为什么单独成一个模块，而不是留在 useAgentInterview 的 finalize 里：
// 「谁先谁后」是最容易被后续改动顺手调换、又最难被人工评审发现的一类缺陷——
// 调换之后一切照常运行，只有在落库失败时才会静默丢成绩。抽成带注入 IO 的纯函数后，
// 顺序本身可以被测试钉死（见 finalizeSession.test.ts），不再依赖评审者的注意力。
//
// 不依赖 React / Dexie：IO 全部由调用方注入，便于单测。

import type { SessionRecord } from '../schemas/learner';

export interface FinalizeSessionDeps {
  /**
   * 待落库的成绩。`null` 表示本轮没有可保存的成绩
   * （一道题都没考察，或整场都没有有效评分）——此时不存在「保存失败」，
   * 草稿也不再有任何恢复价值，直接清理即可。
   */
  record: SessionRecord | null;
  /**
   * 写入 Learner Memory（权威数据）。允许同步实现，但**必须 await**：
   * IndexedDB 落库是异步的，不等它落地就继续删草稿，等于把「写入失败」当成「写入成功」。
   */
  persist: (record: SessionRecord) => Promise<void> | void;
  /**
   * 等待在途的草稿写入排空。
   * 必须先排空再删除：否则删除之后，一条更早发出、更晚完成的在途写入会把草稿**写回来**
   * （草稿复活），用户下次打开会被续面到一场早已结束的面试。
   */
  flushDraft: () => Promise<void>;
  /** 删除可恢复草稿。 */
  deleteDraft: () => Promise<void>;
}

/** `ok: false` **当且仅当**权威落库（`persist`）失败。 */
export type FinalizeOutcome = { ok: true } | { ok: false; error: Error };

/**
 * 收尾提交。**唯一允许的顺序**：
 *
 * 1. `persist` —— 权威落库。失败则立即返回，草稿**原样保留**，调用方可以重试；
 * 2. `flushDraft` —— 排空在途草稿写入；
 * 3. `deleteDraft` —— 删除草稿。
 *
 * 第 1 步绝不可与第 3 步调换：草稿是这次面试结果**唯一**的可恢复副本。先删草稿再落库，
 * 一旦落库失败（存储配额超限、隐私模式禁用 IndexedDB、版本升级期间的 schema 冲突），
 * 用户整场面试的成绩就此永久消失，而且没有任何重试入口——守卫已关、副本已删。
 *
 * 第 2、3 步是尽力而为：成绩已经落库，清理失败不该让用户以为「没保存成功」。
 * 最坏结果是残留一条 `status = finished` 的草稿，而续面只读 `status !== finished`，
 * 它不会被误当成进行中的面试。
 */
export async function finalizeSession(deps: FinalizeSessionDeps): Promise<FinalizeOutcome> {
  const { record, persist, flushDraft, deleteDraft } = deps;

  if (record) {
    try {
      await persist(record);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  try {
    await flushDraft();
    await deleteDraft();
  } catch {
    // 草稿清理失败：权威数据已持久化，不上报为保存失败。
  }
  return { ok: true };
}
