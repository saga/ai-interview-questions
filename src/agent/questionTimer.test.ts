// 每题倒计时状态机：归零会自我清理，但「延长本题时间」必须**重新装载**计时器。
// 用假计时器驱动真实的 setInterval，覆盖「归零 → 延长 → 继续走动」的完整路径。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createQuestionTimer } from './questionTimer';

describe('createQuestionTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function build(limitSec = 3) {
    const ticks: number[] = [];
    const onExpire = vi.fn();
    const timer = createQuestionTimer(limitSec, { onTick: (v) => ticks.push(v), onExpire });
    return { timer, ticks, onExpire };
  }

  it('装载时同步上报满额，随后每秒递减', () => {
    const { timer, ticks } = build(3);
    timer.start();
    expect(ticks).toEqual([3]);
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([3, 2]);
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([3, 2, 1]);
  });

  it('归零：上报 0、触发一次 onExpire，并停止计时（不再空转）', () => {
    const { timer, ticks, onExpire } = build(2);
    timer.start();
    vi.advanceTimersByTime(2000);
    expect(ticks).toEqual([2, 1, 0]);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(timer.isRunning()).toBe(false);

    vi.advanceTimersByTime(5000); // 归零后不得再有任何 tick / onExpire
    expect(ticks).toEqual([2, 1, 0]);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('★延长（归零后再次 start）：倒计时重新走动，而不是停在满格', () => {
    const { timer, ticks, onExpire } = build(2);
    timer.start();
    vi.advanceTimersByTime(2000);
    expect(timer.isRunning()).toBe(false);

    timer.start(); // = 「延长本题时间」
    expect(timer.isRunning()).toBe(true);
    expect(ticks).toEqual([2, 1, 0, 2]); // 重新装载并同步上报满额

    vi.advanceTimersByTime(1000);
    // 只重置数值、不重建 interval 的实现会停在上一步，永远不再变化
    expect(ticks).toEqual([2, 1, 0, 2, 1]);
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([2, 1, 0, 2, 1, 0]);
    expect(onExpire).toHaveBeenCalledTimes(2);
  });

  it('冻结期间不消耗作答时间，解冻后继续', () => {
    const { timer, ticks } = build(5);
    timer.start();
    timer.freeze(true);
    vi.advanceTimersByTime(3000);
    expect(ticks).toEqual([5]);
    timer.freeze(false);
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([5, 4]);
  });

  it('stop 清空剩余秒数（题已答完 → UI 不再显示倒计时）', () => {
    const { timer } = build(5);
    timer.start();
    vi.advanceTimersByTime(1000);
    expect(timer.remaining()).toBe(4);
    timer.stop();
    expect(timer.remaining()).toBeNull();
    expect(timer.isRunning()).toBe(false);
  });

  it('连续两次 start 不会留下两个定时器（每秒只减一次）', () => {
    const { timer, ticks } = build(5);
    timer.start();
    timer.start();
    vi.advanceTimersByTime(1000);
    // 旧定时器若未清理，这里会收到两次 tick
    expect(ticks).toEqual([5, 5, 4]);
  });

  it('归零后 remaining 为 0（而非 null）：UI 仍需显示「本题剩余 00:00」', () => {
    const { timer } = build(1);
    timer.start();
    vi.advanceTimersByTime(1000);
    expect(timer.remaining()).toBe(0);
  });
});
