import type { Phase } from './hooks/useTrainingSession';

/** 应用内的顶层页面。与 App.tsx 的 NAV_ITEMS 一一对应。 */
export type Page = 'train' | 'progress' | 'interview' | 'settings' | 'agent';

/**
 * 训练会话是否处于「进行中」——此刻若离开 /train 会导致白屏（quiz/result 渲染分支
 * 全部 gated 在 page==='train'，离开即无分支命中）。home 阶段未开始，可自由切 tab。
 */
export function isTrainingSessionRunning(phase: Phase): boolean {
  return phase === 'quiz' || phase === 'result';
}

/**
 * 执行一次导航尝试。若训练会话进行中且目标不是训练页，则拒绝导航并提示用户；
 * 否则照常跳转。返回是否被放行（true=已导航 / false=被拦截）。
 *
 * 这是 P0-1 的同一状态一致性修复：开局时已把页面收敛到 /train，此处进一步锁定——
 * 进行中禁止普通 tab 导航，避免「running → /progress → 白屏」这条同等严重的入口。
 */
export function attemptNavigate(opts: {
  target: Page;
  phase: Phase;
  navigate: (to: string) => void;
  warn: (msg: string) => void;
}): boolean {
  const { target, phase, navigate, warn } = opts;
  if (target !== 'train' && isTrainingSessionRunning(phase)) {
    warn('当前正在进行面试，完成或结束后才能切换页面');
    return false;
  }
  navigate(target === 'train' ? '/train' : `/${target}`);
  return true;
}
