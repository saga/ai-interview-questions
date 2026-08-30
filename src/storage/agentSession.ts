// 进行中 Agent 面试草稿的本地持久化（IndexedDB / Dexie）。
// 用途：刷新或重开页面后，依据草稿把被中断的面试续上——Agent 对话历史（messages）、
// 应用状态（session）、已交付题（questions）整体还原，LLM 从断点继续，无需重来。
//
// 设计取舍（对齐 db.ts 的 StoredAgentSession 注释）：
// - 只存重建 createInterviewAgent 所需的纯数据；题库不落库（恢复时由数据文件重新加载）。
// - 存 entryId 而非整份 ProviderEntry，避免 apiKey 持久化到本地库。
// - 存面试开始时的 profile 快照，保证弱项推荐在中断前后一致。

import { z } from 'zod';
import { db, type StoredAgentSession } from './db';
import { learnerProfileSchema } from '../schemas/learner';
import { sessionAnswerSchema, sessionEvaluationSchema, sessionQuestionSchema } from '../schemas/session';
import { recordLog } from './db';

/**
 * 草稿的运行时结构契约（评审 P2）。
 *
 * 为什么需要：IndexedDB 里的数据可能来自**旧版本应用**（schema 演进、手写调试数据、写入中途损坏）。
 * 读取端若直接信任，一个字段漂移就会让续面路径在深层崩溃（且难复现）。
 * 边界原则：Zod 只在边界工作——这里正是「不可信外部存储 → 运行时」的边界。
 *
 * 取舍：`session` 只校验续面真正会解引用的字段，并用 passthrough 保留其余键，
 * 避免把 InterviewAgentSession 全量镜像成 schema 造成维护双份。
 */
const storedAgentSessionSchema = z.object({
  id: z.string().min(1),
  session: z
    .object({
      id: z.string().min(1),
      status: z.string().min(1),
      startedAt: z.number(),
      currentQuestion: sessionQuestionSchema.nullable(),
      answers: sessionAnswerSchema,
      evaluations: sessionEvaluationSchema,
      log: z.array(z.unknown()),
      lastSearchIds: z.array(z.string()),
      fallbackCount: z.number(),
    })
    .passthrough(),
  /** Agent 对话历史（pi-ai 消息结构，形状由运行库保证；只校验是数组，不深度校验）。 */
  messages: z.array(z.unknown()),
  questions: z.array(sessionQuestionSchema),
  entryId: z.string().min(1),
  profile: learnerProfileSchema,
  updatedAt: z.number(),
});

/**
 * 校验一份草稿；失败时**安全丢弃**（删除坏记录并返回 undefined）。
 *
 * 丢弃而非抛错：草稿只是「可恢复快照」，不是权威数据；留着坏记录会让续面每次都失败，
 * 删掉后用户重开一场即可，代价远小于崩溃或反复报错。
 */
function parseDraft(raw: unknown, id: string): StoredAgentSession | undefined {
  const parsed = storedAgentSessionSchema.safeParse(raw);
  if (parsed.success) return parsed.data as StoredAgentSession;
  void recordLog({
    scope: 'agent-session',
    event: 'draft_invalid',
    kind: 'error',
    level: 'error',
    message: '面试草稿结构校验失败，已丢弃该草稿',
    detail: { id, issues: parsed.error.issues.slice(0, 5) },
  });
  void db.agentSessions.delete(id).catch(() => undefined);
  return undefined;
}

/** 保存（upsert）一份进行中面试草稿。fire-and-forget 风格由调用方决定；此处返回 Promise 便于测试/await。 */
export async function saveAgentSession(rec: StoredAgentSession): Promise<void> {
  await db.agentSessions.put({ ...rec, updatedAt: Date.now() });
}

/** 按 id 读取一份草稿；结构不合法时返回 undefined 并删除该记录。 */
export async function loadAgentSession(id: string): Promise<StoredAgentSession | undefined> {
  const raw = await db.agentSessions.get(id);
  if (!raw) return undefined;
  return parseDraft(raw, id);
}

/**
 * 读取当前「进行中」的草稿：取 updatedAt 最新且 status 非 finished 的一份。
 * 本应用同时只进行一场面试，故最多一份；返回 undefined 表示无续面可恢复。
 *
 * 逐条校验：坏草稿会被跳过并删除，因此「最新的一条不合法」时会自动回退到次新的合法草稿。
 */
export async function getActiveAgentSession(): Promise<StoredAgentSession | undefined> {
  const all = await db.agentSessions.toArray();
  const running = all
    .filter((r) => r?.session?.status !== 'finished')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const rec of running) {
    const valid = parseDraft(rec, rec.id);
    if (valid) return valid;
  }
  return undefined;
}

/** 删除一份草稿（面试结束或用户主动重开时调用，避免残留）。 */
export async function deleteAgentSession(id: string): Promise<void> {
  await db.agentSessions.delete(id);
}
