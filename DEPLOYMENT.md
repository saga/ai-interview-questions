# 部署说明（Deployment）

本应用的前端是 Vite + React SPA（构建产物为 `dist/`）。本地开发只启动 Vite，不需要单独的 Express/Node HTTP 服务。Cloudflare Workers AI 的跨域代理与 GitHub Copilot SDK 的运行时接口分别由 Vite 开发代理、Vite 插件承担；它们的生产部署边界不同。

## 1. Cloudflare Workers AI 的同源代理

浏览器调用 `api.cloudflare.com` 时会遇到跨域限制，因此前端请求同源地址：

```text
前端 → /api/ai/client/v4/accounts/{accountId}/ai/v1/...
Vite / Worker → 剥掉 /api/ai 前缀 → https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/...
```

`src/ai/pi.ts` 会把 Cloudflare provider 的绝对 `baseUrl` 替换为当前源上的 `/api/ai` 前缀。开发环境中，`vite.config.ts` 将该路径转发至固定上游 `https://api.cloudflare.com` 并剥掉前缀；生产 Cloudflare 部署由 `worker/index.ts` 处理。上游主机是固定的，不接受由请求内容指定的任意目标地址。

## 2. 本地开发

```bash
npm install
npm run dev       # 只启动 Vite，默认 http://localhost:5173
```

Vite 提供两条开发路径：

- `/api/ai/*`：直接代理到 `https://api.cloudflare.com`，Cloudflare Workers AI 在开发模式可用。
- `/api/copilot-sdk/*`：由根目录的 `vite-plugin-copilot-sdk.ts` 注册为开发中间件。中间件在 Node 侧调用 `@github/copilot-sdk`，复用本机 GitHub Copilot CLI 登录态，浏览器不会拿到 CLI 凭据。接口检查同源 Origin、限制请求体大小，并且不会开放 shell 或文件系统工具。

使用 Copilot SDK 前，需本机安装并登录 GitHub Copilot CLI，并满足 SDK 的 Node.js 版本要求。Provider 模型字段可填 `auto`，或填写当前账户支持的模型 ID。若调用失败，请检查 CLI 安装、登录状态、模型权限及额度。

## 3. Cloudflare Workers 部署

```bash
npm run build
npx wrangler deploy
```

- `wrangler.toml` 使用 `[assets]` 托管 `dist/`，并以 `worker/index.ts` 作为 Worker 入口。
- Worker 继续为 `/api/ai/*` 提供 Cloudflare Workers AI 代理，其余请求交给静态 assets。
- Vite 开发插件只在 `vite dev` 时运行，不会包含在生产 bundle 中；Cloudflare Worker 当前不提供 Copilot SDK API。

## 4. GitHub Pages 等纯静态托管

纯静态托管没有服务端，无法提供 `/api/ai` 代理，因此 Cloudflare Workers AI provider 不能直接在这类部署里工作；需要另外部署受控的同源代理。其他浏览器直连 Provider 仍取决于它们的 CORS 支持。

Copilot SDK 同样不能在静态页面里运行，因为它依赖 Node 侧 SDK 与本机 CLI 登录态。当前的 `copilot-sdk` Provider 仅用于本地 `npm run dev`；若未来需要生产使用，应单独设计有身份认证、授权和运行隔离的后端服务，不能将 CLI 凭据打进浏览器 bundle，也不能把 Vite dev server 当作生产后端。

## 5. Agent 面试的运行时边界

普通问答、开放题评分、运行时变体及题目质询已可通过 Copilot SDK Provider 发起 one-shot 调用。Agent 面试目前依赖 `pi-agent-core` 的流式工具调用协议，Copilot SDK 尚未接入这个契约；使用 Agent 面试时请同时启用另一个支持该运行时的 Provider。

旧的 `server/index.js`、Express 依赖与 `npm run server` 脚本已移除。
