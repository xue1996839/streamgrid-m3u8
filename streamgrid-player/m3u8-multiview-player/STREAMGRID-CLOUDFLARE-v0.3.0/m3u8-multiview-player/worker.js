const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function readJson(request) {
  try { return await request.json(); }
  catch { throw new Error("请求内容不是有效 JSON"); }
}

function randomCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

export class SessionRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method;

    if (url.pathname === "/create" && method === "POST") {
      const existing = await this.ctx.storage.get("session");
      if (existing && existing.expiresAt > Date.now()) {
        return json({ error: "配对码冲突，请重试" }, 409);
      }
      try {
        const body = await readJson(request);
        const now = Date.now();
        const session = {
          state: body.state || { layout: 1, slots: [] },
          createdAt: now,
          updatedAt: now,
          expiresAt: now + SESSION_TTL_MS
        };
        await this.ctx.storage.put("session", session);
        return json({ ok: true, expiresAt: session.expiresAt }, 201);
      } catch (error) {
        return json({ error: error.message }, 400);
      }
    }

    const session = await this.ctx.storage.get("session");
    if (!session || session.expiresAt <= Date.now()) {
      if (session) await this.ctx.storage.delete("session");
      return json({ error: "投屏码不存在或已过期，请重新连接" }, 404);
    }

    if (method === "GET") {
      return json({ state: session.state, updatedAt: session.updatedAt, expiresAt: session.expiresAt });
    }

    if (method === "POST") {
      try {
        const body = await readJson(request);
        session.state = body.state || body;
        session.updatedAt = Date.now();
        await this.ctx.storage.put("session", session);
        return json({ ok: true, updatedAt: session.updatedAt });
      } catch (error) {
        return json({ error: error.message }, 400);
      }
    }

    if (method === "DELETE") {
      await this.ctx.storage.delete("session");
      return json({ ok: true });
    }

    return json({ error: "方法不支持" }, 405);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/info" && request.method === "GET") {
      return json({ mode: "cloud", addresses: [], urls: [], host: "Cloudflare" });
    }

    if (path === "/api/session/create" && request.method === "POST") {
      let body;
      try { body = await readJson(request); }
      catch (error) { return json({ error: error.message }, 400); }

      for (let attempt = 0; attempt < 12; attempt++) {
        const code = randomCode();
        const id = env.SESSIONS.idFromName(code);
        const stub = env.SESSIONS.get(id);
        const response = await stub.fetch("https://session.internal/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: body.state || { layout: 1, slots: [] } })
        });
        if (response.status === 201) {
          const result = await response.json();
          return json({ code, expiresAt: result.expiresAt }, 201);
        }
        if (response.status !== 409) return response;
      }
      return json({ error: "暂时无法创建投屏会话，请重试" }, 503);
    }

    const match = path.match(/^\/api\/session\/(\d{6})$/);
    if (match) {
      const id = env.SESSIONS.idFromName(match[1]);
      const stub = env.SESSIONS.get(id);
      return stub.fetch(new Request(`https://session.internal/session`, request));
    }

    if (path.startsWith("/api/")) return json({ error: "API 不存在" }, 404);

    if ((path === "/receiver" || path === "/receiver/") && env.ASSETS) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/receiver.html";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
