# 项目长期笔记：ai-interview-questions

## 验证命令（重要，别用错的）

- **`npm run typecheck` 之前是空跑**：根 `tsconfig.json` 是 `files: []` + `references`
  （solution style），`tsc --noEmit` 对其无效（`--listFiles` 输出 0 个文件）。
  2026-09-03 已改为 `tsc -p tsconfig.app.json && tsc -p tsconfig.node.json`，覆盖 145 个文件。
  **验证是否真的检查了文件**，用 `tsc -p <cfg> --listFiles | wc -l`。
- `tsconfig.app.json` 管 `src`（排除 `*.test.ts`），`tsconfig.node.json` 管 `vite.config.ts` + `scripts`。
  改 `scripts/` 下的 TS 只会由后者检查——这也是之前错误长期被掩盖的原因。
- `node_modules/.bin` 曾损坏（vite-node / vitest / tsc 都 command not found）。
  绕过：直接 `node node_modules/<pkg>/dist/cli.js` 或 `node node_modules/typescript/bin/tsc`。

## 响应式约定

- 断点 **768px**，两处必须同步：`src/hooks/useIsMobile.ts` 的 `MOBILE_BREAKPOINT`
  与 `src/index.css` 的 `@media (max-width: 768px)`。
- **分工原则：结构决策归 JS（`useIsMobile`），纯样式归 CSS（且不用 `!important`）。**
  不要在组件里用内联样式设置、又想在 CSS media query 里覆盖同一属性——那必须加 `!important`，
  而 `!important` 会在组件「关闭但仍挂载」时错误生效（2026-09-03 的移动端白屏 P0 就是这么来的）。

## 其它

- **CSS 回落值（如 `100vh` + `100dvh`）只能写 CSS 文件**。写成内联样式对象会触发
  `TS1117: An object literal cannot have multiple properties with the same name`。
  需要同名属性回落时，改为加 class 把样式挪进 `index.css`。
- **JSX 注释不能放进三元表达式的分支里**（`? ( {/*…*/} <X/> )` → TS2657「JSX expressions must
  have one parent element」）。括号表达式里要注释就用 `// ` 行注释。
- 用户偏好：回答专业、简明扼要，不过多延展；好的地方不用提；执行完毕的项目打勾。
- 内存目录曾出现 `.workbuddy-ai/memory/` 与 `.workbuddy/memory/` 两份，以 `.workbuddy-ai/` 为准。
