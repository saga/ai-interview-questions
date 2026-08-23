// Chrome Built-in AI（Prompt API）底层封装：浏览器自带的本地模型，无需 API Key、无网络外发。
// 与 pi.ts 对等——只做"可用性检测 + 一次性补全"，业务语义在 variant / evaluate。
// 兼容性由运行时能力检测决定（LanguageModel 不存在 → unavailable），不做 polyfill（ADR-021）。

/** Chrome Prompt API 的可用性状态（与 LanguageModel.availability() 对齐）。 */
export type ChromeAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface ChromeSessionLike {
  prompt(input: string): Promise<string>;
  destroy?(): void;
}

interface LanguageModelLike {
  availability?(): Promise<ChromeAvailability>;
  create(options?: {
    initialPrompts?: Array<{ role: string; content: string }>;
    monitor?: unknown;
  }): Promise<ChromeSessionLike>;
}

/** 取全局 LanguageModel（Prompt API）；不支持的环境返回 undefined。独立导出便于测试注入。 */
export function getLanguageModel(): LanguageModelLike | undefined {
  return (globalThis as { LanguageModel?: LanguageModelLike }).LanguageModel;
}

/** 检测当前环境的内置模型可用性；API 缺失或检测失败一律返回 unavailable。 */
export async function chromeAvailability(): Promise<ChromeAvailability> {
  const lm = getLanguageModel();
  if (!lm?.availability) return 'unavailable';
  try {
    const s = await lm.availability();
    return s ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** 一次性补全：每次调用新建 session（one-shot 无状态架构），用完即销毁。 */
export async function chromeComplete(system: string, user: string): Promise<string> {
  const lm = getLanguageModel();
  if (!lm) {
    throw new Error('当前浏览器不支持 Chrome 内置 AI（Prompt API），请在设置中改用云端服务商');
  }
  if ((await chromeAvailability()) === 'unavailable') {
    throw new Error('Chrome 内置 AI 模型在当前环境不可用，请在设置中改用云端服务商');
  }
  const session = await lm.create({
    initialPrompts: [{ role: 'system', content: system }],
  });
  try {
    return (await session.prompt(user)) ?? '';
  } finally {
    session.destroy?.();
  }
}
