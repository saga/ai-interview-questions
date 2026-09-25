// 每题倒计时状态机：到点**不自动跳题**，只置「时间到」等用户选择「延长本题」或「跳到下一题」。
//
// 为什么抽成独立模块：这里的核心契约是「延长 = 重新装载计时器」，而不是「把秒数改回满额」。
// 计时器归零时会自我清理（否则归零后仍每秒空转），所以归零之后只重置剩余秒数是不够的——
// 显示会永久停在满格、再也不会走动（用户点了「延长本题」，时间却纹丝不动）。
// 这类缺陷在人工评审里几乎不可见，抽出来才能用假计时器把契约钉死。
//
// 不依赖 React：只接收两个回调，便于单测（用 vi.useFakeTimers 驱动全局 setInterval）。

/** 一秒一步。抽成常量便于测试与阅读。 */
export const TICK_MS = 1000;

export interface QuestionTimerCallbacks {
  /** 剩余秒数变化（装载时也会同步触发一次满额值）。 */
  onTick: (remainingSec: number) => void;
  /** 归零。仅触发一次，直到下一次 `start()`。 */
  onExpire: () => void;
}

export interface QuestionTimer {
  /**
   * 装载并启动本题倒计时（重置为满额时长）。
   * 交付新题与「延长本题时间」**共用**这一个入口——这正是延长能重新走动的原因。
   */
  start: () => void;
  /** 停止计时并清空剩余秒数（题已答完 / 收尾 / 离开面试）。 */
  stop: () => void;
  /** 冻结 / 解冻：面试官思考与评分期间不消耗用户的作答时间。 */
  freeze: (frozen: boolean) => void;
  /** 是否正在计时（归零后为 false，直到再次 `start()`）。 */
  isRunning: () => boolean;
  /** 当前剩余秒数；未装载（或已 `stop`）为 null，归零后为 0。 */
  remaining: () => number | null;
}

export function createQuestionTimer(
  limitSec: number,
  callbacks: QuestionTimerCallbacks,
): QuestionTimer {
  let id: ReturnType<typeof setInterval> | null = null;
  let remainingSec: number | null = null;
  let frozen = false;

  /** 只清定时器，保留 remainingSec —— 归零路径用它，UI 仍需显示 0。 */
  function clearId(): void {
    if (id !== null) {
      clearInterval(id);
      id = null;
    }
  }

  function stop(): void {
    clearId();
    remainingSec = null;
    frozen = false;
  }

  function start(): void {
    // 先停掉可能存在的上一个定时器：重复 start（如连续点两次「延长」）不得留下两个 interval。
    stop();
    remainingSec = limitSec;
    callbacks.onTick(limitSec);
    id = setInterval(() => {
      // busy / submitting 期间冻结：面试官思考与评分不消耗作答时间。
      if (frozen) return;
      if (remainingSec === null) return;
      const next = Math.max(0, remainingSec - 1);
      remainingSec = next;
      callbacks.onTick(next);
      if (next <= 0) {
        // 归零即自我清理，不再空转。**故「延长本题」必须走 start() 重新装载**，
        // 只把 remainingSec 改回满额会让倒计时永久静止。
        clearId();
        callbacks.onExpire();
      }
    }, TICK_MS);
  }

  return {
    start,
    stop,
    freeze: (f) => {
      frozen = f;
    },
    isRunning: () => id !== null,
    remaining: () => remainingSec,
  };
}
