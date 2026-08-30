// 进行中 Agent 面试草稿的本地持久化（IndexedDB / Dexie）。
// 用途：刷新或重开页面后，依据草稿把被中断的面试续上——Agent 对话历史（messages）、
// 应用状态（session）、已交付题（questions）整体还原，LLM 从断点继续，无需重来。
//
// 设计取舍（对齐 db.ts 的 StoredAgentSession 注释）：
// - 只存重建 createInterviewAgent 所需的纯数据；题库不落库（恢复时由数据文件重新加载）。
// - 存 entryId 而非整份 ProviderEntry，避免 apiKey 持久化到本地库。
// - 存面试开始时的 profile 快照，保证弱项推荐在中断前后一致。

import { db, type StoredAgentSession } from './db';

/** 保存（upsert）一份进行中面试草稿。fire-and-forget 风格由调用方决定；此处返回 Promise 便于测试/await。 */
export async function saveAgentSession(rec: StoredAgentSession): Promise<void> {
  await db.agentSessions.put({ ...rec, updatedAt: Date.now() });
}

/** 按 id 读取一份草稿。 */
export async function loadAgentSession(id: string): Promise<StoredAgentSession | undefined> {
  return db.agentSessions.get(id);
}

/**
 * 读取当前「进行中」的草稿：取 updatedAt 最新且 status 非 finished 的一份。
 * 本应用同时只进行一场面试，故最多一份；返回 undefined 表示无续面可恢复。
 */
export async function getActiveAgentSession(): Promise<StoredAgentSession | undefined> {
  const all = await db.agentSessions.toArray();
  const running = all
    .filter((r) => r.session.status !== 'finished')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return running[0];
}

/** 删除一份草稿（面试结束或用户主动重开时调用，避免残留）。 */
export async function deleteAgentSession(id: string): Promise<void> {
  await db.agentSessions.delete(id);
}
