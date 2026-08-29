// Cloudflare 专用同源代理 Worker。
// 仅服务于 cloudflare-workers-ai 这一个 provider：把浏览器发来的同源请求
//   /api/ai/client/v4/accounts/{account}/ai/v1/...
// 在服务端重写为
//   https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/...
// 再转发，从而绕过浏览器直连 api.cloudflare.com 时的 CORS 拦截。
// 其它路径一律回退到 ASSETS 提供静态 SPA。绝不代理任何第三方 provider。

const API_PREFIX = '/api/ai';
const TARGET_HOST = 'api.cloudflare.com';

interface Env {
  ASSETS: { fetch: (request: Request | string) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 仅 /api/ai/* 走 Cloudflare 代理；其它请求交给静态资源。
    if (url.pathname.startsWith(API_PREFIX + '/')) {
      return proxyCloudflare(request, url);
    }
    return env.ASSETS.fetch(request);
  },
};

async function proxyCloudflare(request: Request, url: URL): Promise<Response> {
  const target = new URL(request.url);
  target.protocol = 'https:';
  target.host = TARGET_HOST;
  // 去掉 /api/ai 前缀：/api/ai/client/v4/accounts/{acct}/ai/v1/... -> /client/v4/accounts/{acct}/ai/v1/...
  target.pathname = url.pathname.slice(API_PREFIX.length);

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'follow',
  };
  // 非 GET/HEAD 读取完整 body 文本转发（自动带正确 content-length）。
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text();
  }

  try {
    return await fetch(target.toString(), init);
  } catch (err) {
    return new Response(`Cloudflare 代理转发失败：${String(err)}`, { status: 502 });
  }
}
