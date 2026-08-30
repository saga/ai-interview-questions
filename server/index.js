// 可选的 Node.js / Express 服务（非强依赖）。
//
// 设计原则：这是「可选」组件，应用在无此服务时也必须能正常工作——
//   · 本地开发由 Vite dev server（vite.config.ts 的 proxy）同源代理 /api/ai；
//   · 生产环境由 Cloudflare 纯静态 Assets 托管 dist/，本服务可作为可选的后端，
//     既同源代理 /api/ai/*，也可直接 serve 构建产物 dist/。
// 本服务是 Cloudflare Workers AI 浏览器直连 CORS 问题的唯一服务端解法：把构建产物
// dist/ 以同源方式 serve 出来，并代理 /api/ai/* 到 https://api.cloudflare.com，
// 从而能在本机或自有 Node 主机以「同源」方式跑完整应用、规避浏览器直连 Cloudflare 的
// CORS。它是可选依赖（不参与 Cloudflare 静态构建与部署），仅在需要服务端能力时启用。
//
// 用法：
//   npm run build   # 先构建出 dist/
//   npm run server  # 再启动本服务（默认 http://localhost:3000）
// 不运行它，应用照常通过 Vite 开发代理工作；Cloudflare 部署则为纯静态托管。

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const API_PREFIX = '/api/ai';
const TARGET_HOST = 'api.cloudflare.com';
const PORT = Number(process.env.PORT) || 3000;

const app = express();

// ---------------------------------------------------------------------------
// 可选 Cloudflare 同源代理：仅 /api/ai/* 走服务端转发，绝不代理任何第三方 provider。
// 与 vite.config.ts 的 dev proxy 转发逻辑保持一致：剥掉 /api/ai 前缀后请求 api.cloudflare.com，
// 原样转发 method / headers（含 Authorization）/ body，回传 upstream 的响应。
// ---------------------------------------------------------------------------
app.use(API_PREFIX, async (req, res) => {
  // 保留完整原始路径（含 query），剥掉前缀：/api/ai/client/v4/... -> /client/v4/...
  const stripped = (req.originalUrl || '').replace(API_PREFIX, '') || '/';
  const targetUrl = new URL(stripped, `https://${TARGET_HOST}`);

  // SECURITY（防 SSRF / 开放中继）：代理只允许转发到固定的 Cloudflare 主机。
  // 若请求路径是协议相对（//evil.com）或绝对 URL，new URL 会把主机解析成攻击者控制的域名，
  // 导致本服务变成对任意主机的开放代理并转发 Authorization 头。必须在此硬性拦截。
  if (targetUrl.hostname !== TARGET_HOST || targetUrl.protocol !== 'https:') {
    res.status(400).type('text').send('Invalid proxy target host');
    return;
  }

  // 复制请求头，剔除逐跳（hop-by-hop）与会被 fetch 自动重算的字段。
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers['content-length'];
  delete headers['transfer-encoding'];

  const init = { method: req.method, headers, redirect: 'follow' };

  // 非 GET/HEAD 读取完整 body 文本转发（自动带正确的 content-length）。
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    init.body = Buffer.concat(chunks);
  }

  try {
    const upstream = await fetch(targetUrl.toString(), init);
    const respHeaders = {};
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === 'connection' || lower === 'transfer-encoding' || lower === 'content-length') return;
      respHeaders[key] = value;
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).set(respHeaders).send(body);
  } catch (err) {
    res.status(502).type('text').send(`Cloudflare 代理转发失败：${String(err)}`);
  }
});

// ---------------------------------------------------------------------------
// 静态资源：serve 构建产物 dist/（若已构建）。SPA 回退到 index.html。
// 未构建时给出友好提示，不阻塞服务启动（代理部分仍可独立工作）。
// ---------------------------------------------------------------------------
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // 兜底：未知路径回退到 index.html（本项目用 HashRouter，同源下无碍）。
  app.use((req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
} else {
  app.get('/', (_req, res) => {
    res.type('text').send(
      '未找到 dist/ 构建目录。请先运行 `npm run build`，再启动本服务。\n' +
        '（此 Node 服务为可选组件，仅用于本地以同源方式提供构建产物并代理 Cloudflare API，规避 CORS。）'
    );
  });
}

app.listen(PORT, () => {
  console.log(`[optional-server] listening on http://localhost:${PORT}`);
  console.log(`  /api/ai/* -> https://${TARGET_HOST} (Cloudflare 同源代理，可选)`);
  if (!fs.existsSync(DIST_DIR)) {
    console.warn('  ⚠️ dist/ 不存在：静态资源未提供，请先 `npm run build`。代理仍可用。');
  }
});
