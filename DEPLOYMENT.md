# 部署说明（Deployment）

本应用是纯前端 SPA（Vite + React，构建产物 `dist/`）。**Cloudflare Workers AI 这一 provider 必须有一个「同源代理」才能用**，本文档说明为什么、以及各部署方式下的正确配置。

---

## 1. 为什么需要同源代理（关键背景）

Cloudflare Workers AI 的 REST 域名 `api.cloudflare.com` **不返回 CORS 头**，浏览器从前端直连它会被同源策略拦截（表现为 `Connection error` / 请求失败）。

因此前端不能直连 `api.cloudflare.com`，而是请求**与自己同源**的 `/api/ai/...`，再由服务端把这段前缀剥掉、转发到 `api.cloudflare.com`：

```
前端   →  /api/ai/client/v4/accounts/{accountId}/ai/v1/...      （同源，无 CORS）
服务端 →  剥掉 /api/ai 前缀  →  https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/...
```

`src/ai/pi.ts` 的 `getModel` 会把 cloudflare provider 的 `baseUrl` 由 pi-ai 内置的
`https://api.cloudflare.com/...` **仅替换源**为同源代理前缀 `${location.origin}/api/ai/...`，
保留 pi-ai 原有的 `{CLOUDFLARE_ACCOUNT_ID}` 占位符与路径拼接（accountId 由 credential store 注入）。
注意 `baseUrl` 必须是**绝对 URL**——pi-ai 底层用 OpenAI SDK，会对 `baseUrl` 执行 `new URL()`，
传相对路径会抛 `Failed to construct 'URL': Invalid URL`。

**核心结论：代理必须存在于「部署目标自己的源(origin)」上。** 它只活在服务端，前端代码里没有任何可被部署带走的代理逻辑。

---

## 2. 各部署方式对照

| 部署方式 | 代理由谁提供 | cloudflare provider 是否可用 |
|---|---|---|
| 本地 `npm run dev` | Vite dev proxy → 可选 Node 服务(`server/index.js`, 端口 3000) | ✅ 可用 |
| Cloudflare Workers(`wrangler deploy`) | `worker/index.ts`(main 脚本) | ✅ 可用 |
| 自有 Node 主机 | 直接运行 `npm run server`(含 `server/index.js`) | ✅ 可用 |
| **GitHub Pages(纯静态)** | **无** | ❌ **不可用** |

> 其它 cloud provider（deepseek / openrouter / google）走各自默认 `baseUrl`，在任意静态托管上是否可用取决于其域名是否返回 CORS 头；`local` provider 仅本机有效。

---

## 3. 本地开发

```bash
npm install
npm run dev      # 并行启动 Vite(5173) 与可选 Node 服务(3000)
```

链路：`前端(:5173) → vite proxy(/api/ai) → Node 服务(:3000) → api.cloudflare.com`。
Node 服务(`server/index.js`)是**可选**的，仅用于本地以同源方式代理 Cloudflare、规避 CORS；
不运行时应用照常工作，只是 cloudflare provider 无法调用。

---

## 4. Cloudflare Workers 部署（推荐）

```bash
npm run build
npx wrangler deploy
```

- `wrangler.toml` 同时配置 `[assets]`(托管 `dist/`)与 `main = "./worker/index.ts"`。
- `worker/index.ts` 是极薄的服务端：收到 `/api/ai/*` 时剥前缀并转发到 `api.cloudflare.com`
  （与 `server/index.js` 转发逻辑一致）；其它路径交给 `[assets]` 提供静态 SPA。
- 这样 `wrangler deploy` 后 cloudflare provider 在生产环境真正可用。

---

## 5. GitHub Pages（纯静态，cloudflare provider 不可用）

GitHub Pages 只托管静态文件，**没有任何服务端代码**，无法提供 `/api/ai` 代理：

- 部署后页面照常加载，但**启用 cloudflare 模型时会调用失败**（请求 `/api/ai/...` 得到 404，
  被应用包成「⚠️ 模型调用失败」提示）。应用不会整体崩溃，仅该 provider 不可用。
- 若一定要在 GitHub Pages 上用 cloudflare provider，必须**外接一个代理**，例如：
  - 你自己挂的一个 Cloudflare Worker（单独部署，把 `你的域名/api/ai/*` 转发到 `api.cloudflare.com`），
    然后前端 `baseUrl` 指向该 Worker 域名（需相应改造 `getModel`）；
  - 或其它 serverless / 自建反向代理。
- 纯静态方案下，建议改用 `local` / `openrouter` / `deepseek` 等在浏览器端可用的 provider
  （前提是对应域名返回 CORS 头）。

---

## 6. 代理前缀约定

`/api/ai` 是各环境统一的同源代理前缀：

- `vite.config.ts`：`server.proxy['/api/ai']` → `http://localhost:3000`
- `server/index.js`：剥离 `/api/ai` → `https://api.cloudflare.com`
- `worker/index.ts`：剥离 `/api/ai` → `https://api.cloudflare.com`

三者剥离逻辑一致：请求路径 `/api/ai/client/v4/...` 在服务端变成 `/client/v4/...` 再转发。
