# 部署说明（Deployment）

本应用是纯前端 SPA（Vite + React，构建产物 `dist/`，HashRouter）。当前 provider 白名单为：

`chrome` / `local` / `deepseek` / `google` / `copilot-sdk` / `codebuddy-sdk`

`openrouter` 与 `cloudflare-workers-ai` 已从白名单、配置样例、设置 UI 和运行时装配中彻底移除：旧 localStorage 配置读取时会被丢弃，高级 JSON 编辑器保存时会拒绝。

---

## 1. 各部署方式对照

| 部署方式 | 页面 | 云端 provider | 本地 SDK |
|---|---|---|---|
| 本地 `npm run dev`（Vite :5173） | ✅ | ✅ 浏览器直连各自默认地址 | ✅ CodeBuddy / Copilot |
| 本机 `npm run server`（:3000，可选） | ✅（serve `dist/`） | ✅ | ❌ |
| Cloudflare Workers（`wrangler deploy`） | ✅ | ✅ | ❌ |
| Cloudflare Pages（`*.pages.dev`） | ✅ | ✅ | ❌ |
| GitHub Pages / 其它纯静态 | ✅ | ✅ | ❌ |

> `/api/ai/*` 代理代码仍保留在 `worker/index.ts`、`server/index.js` 与 `vite.config.ts` 中，但当前没有任何 provider 使用它，属于待清理的遗留通道。

---

## 2. 本地开发

```bash
npm install
npm run dev      # Vite(5173) + 可选 Node 服务(3000)
```

浏览器请打开 **`http://localhost:5173`**：

- Vite dev server 提供页面，并通过 `vite-plugin-copilot-sdk.ts` / `vite-plugin-codebuddy-sdk.ts` 暴露本机 SDK 接口。
- 两个 SDK 接口只允许 localhost / 127.0.0.1 / ::1 访问，CLI 凭据始终留在 Node 进程，不进入浏览器配置。
- Node server(:3000) 是可选的；不运行时应用照常工作。

### GitHub Copilot SDK
启用 `copilot-sdk` 需要本机安装并登录 GitHub Copilot CLI。模型字段可填 `auto` 或账户支持的模型 ID，不需要 API Key。

### Tencent CodeBuddy Agent SDK
启用 `codebuddy-sdk` 需要本机安装 CodeBuddy CLI 并完成登录。模型留空时使用 CLI 默认模型。Node.js 要求 22.13+，`persistSession: false` 要求 CLI 2.125.1+。

两个 SDK 都只支持 one-shot 调用；不加载用户/项目设置、Skills 或 MCP，不开放文件、Shell 等工具，不持久化 Session。超时或客户端断开会触发 abort、Query interrupt 与迭代器清理。它们不接入 Agent 面试的工具调用运行时，也不存在于生产构建中。

---

## 3. Cloudflare Workers 部署

```bash
npm run build
npm run cloudflare:deploy     # = wrangler deploy
```

- `wrangler.toml` 配置 `[assets]`（托管 `dist/`）和 `not_found_handling = "single-page-application"`。
- `main = "./worker/index.ts"` 仍保留遗留 `/api/ai/*` 代理；其它路径交给 `[assets]`。

---

## 4. Cloudflare Pages 部署

Pages 项目只托管 `dist/`，用于让 `*.pages.dev` 正常打开页面：

- **Git 集成**：Cloudflare 控制台 → Workers & Pages → `ai-interview-questions` → Settings → Build & deployment，设置 Build command = `npm run build`、Build output directory = `dist`、Root directory = 空，然后重新部署。
- **CLI 部署**：`npm run cloudflare:pages:deploy`（`npm run build && wrangler pages deploy dist --project-name ai-interview-questions`，需 `CLOUDFLARE_API_TOKEN` 具备 Pages 编辑权限）。

Pages 没有 Worker，也没有本地 SDK 接口；只保证页面和云端 provider 可用。

---

## 5. 其它纯静态托管（GitHub Pages 等）

只托管 `dist/` 即可，SPA 回退到 `index.html`。deepseek / google 走各自默认 `baseUrl`，是否可用取决于对应域名是否返回 CORS 头；本地 SDK 不可用。
