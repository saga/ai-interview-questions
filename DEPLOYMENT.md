# 部署说明

本应用的前端是 Vite + React SPA。日常开发只需启动 Vite；不再启动单独的 Express/Node HTTP 服务。

## 本地开发

```bash
npm install
npm run dev       # Vite，默认 http://localhost:5173
npm run build
npm run preview   # 只预览静态构建产物
```

Vite 提供两条开发期 API 路径：

- `/api/ai/*`：Vite 代理到固定上游 `https://api.cloudflare.com`，剥掉 `/api/ai` 前缀后转发，用于 Cloudflare Workers AI。
- `/api/copilot-sdk/*`：由根目录的 `vite-plugin-copilot-sdk.ts` 注册为 Vite 开发中间件。中间件在 Node 侧调用 `@github/copilot-sdk`，复用本机 GitHub Copilot CLI 登录状态；浏览器不会拿到 CLI 凭据。

使用 Copilot SDK 前，需在本机安装并登录 GitHub Copilot CLI，并满足 SDK 自身的 Node.js 版本要求。Provider 的模型字段可填 `auto`，或填当前账户可用的 Copilot 模型 ID。首次调用失败时，先检查 CLI 安装、登录状态、模型权限与额度。

## 生产部署边界

`npm run build` 生成的仍是静态 SPA。Vite 开发插件不会被打包进生产版本，也不会通过 `vite preview` 提供。Cloudflare Worker 继续只代理 `/api/ai/*` 的 Cloudflare Workers AI 请求；当前不为 `copilot-sdk` 暴露生产 API。

因此，`copilot-sdk` 是本地开发 Provider；若未来需要部署后也能使用，需要另行设计受认证保护的服务端运行时。不要把 SDK 或本机 Copilot 凭据打进浏览器 bundle，也不要把 Vite dev server 当成生产后端。

## 需要注意

- 其他 Provider 的运行方式不变：Chrome 内置 AI 在浏览器执行，本地 OpenAI 兼容服务与支持 CORS 的云 Provider 按原有实现调用。
- Agent 面试页当前使用 `pi-agent-core` 的流式工具调用协议。Copilot SDK 已接入普通问答、开放题评分、运行时变体与题目质询，但尚未适配 Agent 面试所需的工具调用协议；若要使用 Agent 面试，请同时启用另一个支持该运行时的引擎。
- `server/index.js` 与 Express 依赖已移除；Cloudflare 的开发期代理由 Vite 直接承担。
