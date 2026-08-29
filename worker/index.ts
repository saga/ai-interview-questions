// Cloudflare Workers + Assets 入口（wrangler.toml 的 main = "./worker/index.ts"）。
//
// 职责：
//   · /api/ai/*  → 同源代理到 https://api.cloudflare.com（解决浏览器直连 CORS 问题）
//   · 其它路径   → 交给 [assets] 提供静态 SPA（已配置 not_found_handling = single-page-application）
//
// 转发逻辑与本地可选 Node 服务（server/index.js）保持一致：剥掉 /api/ai 前缀后，
// 原样转发 method / headers（含 Authorization）/ body 到 api.cloudflare.com。
// 二者服务不同部署目标（本 Worker 负责 Cloudflare 生产；Node 服务负责本地 dev / 自有 Node 主机），
// 但代理行为统一，前端无需感知差异。

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const API_PREFIX = '/api/ai';
const TARGET_HOST = 'api.cloudflare.com';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 仅 cloudflare provider 的同源代理走这里；未启用时前端不会发 /api/ai 请求。
    if (url.pathname.startsWith(API_PREFIX)) {
      return proxyCloudflare(request, url);
    }

    // 静态资源 / SPA：由 [assets] 提供（含 SPA 回退到 index.html）。
    return env.ASSETS.fetch(request);
  },
};

async function proxyCloudflare(request: Request, url: URL): Promise<Response> {
  // 剥掉 /api/ai 前缀：/api/ai/client/v4/... -> /client/v4/...
  const strippedPath = url.pathname.replace(API_PREFIX, '') || '/';
  const targetUrl = new URL(strippedPath + url.search, `https://${TARGET_HOST}`);

  // 复制请求头，剔除逐跳（hop-by-hop）与会被运行时重算的字段。
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'connection' || lower === 'content-length' || lower === 'transfer-encoding') {
      continue;
    }
    headers.set(key, value);
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'follow',
  };

  // GET/HEAD 不带 body；其余（POST 等）按流原样转发，由运行时重算 content-length。
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  try {
    const upstream = await fetch(targetUrl.toString(), init);
    // 回传上游响应，剔除逐跳头（保留流式 body 以兼容 SSE）。
    const respHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === 'connection' || lower === 'transfer-encoding' || lower === 'content-length') return;
      respHeaders.set(key, value);
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  } catch (err) {
    return new Response(`Cloudflare 代理转发失败：${String(err)}`, { status: 502 });
  }
}
