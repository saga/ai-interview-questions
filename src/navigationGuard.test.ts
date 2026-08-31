import { describe, it, expect, vi } from 'vitest';
import { attemptNavigate, isTrainingSessionRunning, type Page } from './navigationGuard';

const NON_TRAIN: Page[] = ['progress', 'settings', 'agent', 'interview'];

describe('isTrainingSessionRunning', () => {
  it('quiz / result 视为进行中', () => {
    expect(isTrainingSessionRunning('quiz')).toBe(true);
    expect(isTrainingSessionRunning('result')).toBe(true);
  });
  it('home 视为未开始（可自由导航）', () => {
    expect(isTrainingSessionRunning('home')).toBe(false);
  });
});

describe('attemptNavigate — P0-1 进行中锁定普通 tab 导航', () => {
  it('进行中会话尝试切到 /progress：被拒绝、不导航、给出明确提示', () => {
    const navigate = vi.fn();
    const warn = vi.fn();
    const ok = attemptNavigate({ target: 'progress', phase: 'quiz', navigate, warn });
    expect(ok).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('当前正在进行面试，完成或结束后才能切换页面');
  });

  it('进行中会话切到 /train：放行（同页 no-op，结束/重开由 hook 处理）', () => {
    const navigate = vi.fn();
    const ok = attemptNavigate({ target: 'train', phase: 'result', navigate, warn: vi.fn() });
    expect(ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/train');
  });

  it('进行中会话切到 settings / agent / interview 均被拒绝', () => {
    for (const t of NON_TRAIN) {
      const navigate = vi.fn();
      const warn = vi.fn();
      const ok = attemptNavigate({ target: t, phase: 'quiz', navigate, warn });
      expect(ok).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    }
  });

  it('home 阶段：任意 tab（含 train）均可自由切换', () => {
    for (const t of [...NON_TRAIN, 'train'] as Page[]) {
      const navigate = vi.fn();
      const ok = attemptNavigate({ target: t, phase: 'home', navigate, warn: vi.fn() });
      expect(ok).toBe(true);
      expect(navigate).toHaveBeenCalledWith(t === 'train' ? '/train' : `/${t}`);
    }
  });
});
