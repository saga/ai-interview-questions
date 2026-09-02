import { useEffect, useState } from 'react';

/**
 * 移动端断点（px）。**必须与 `src/index.css` 里的 `@media (max-width: 768px)` 保持一致**——
 * 两边各写一份数字容易漂移，改的时候一起改。
 *
 * 分工：能用 CSS 表达的（留白、字号、换行）交给 CSS；
 * 只有「样式表达不了的结构决策」（切换为浮层、隐藏文字标签）才用本 hook。
 */
export const MOBILE_BREAKPOINT = 768;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`;

/** 窄屏判定。SSR / 无 matchMedia 环境下安全返回 false。 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches); // 挂载时视口可能已经变过（如 SSR 首帧后）
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
