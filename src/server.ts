import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { sendText } from "weixin-agent-sdk";

export type ServerOptions = {
  port?: number;
  /** Bearer token for API authentication. If set, all requests must include it. */
  apiToken?: string;
};

export function startServer(opts?: ServerOptions) {
  const port = opts?.port ?? 3000;
  const apiToken = opts?.apiToken;

  const app = new Hono();

  // Auth middleware
  if (apiToken) {
    app.use("/api/*", async (c, next) => {
      const auth = c.req.header("Authorization");
      if (auth !== `Bearer ${apiToken}`) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    });
  }

  // Health check
  app.get("/", (c) => c.json({ status: "ok" }));

  // Send message to a WeChat user
  app.post("/api/send", async (c) => {
    const body = await c.req.json<{
      userId: string;
      text: string;
      accountId?: string;
    }>();

    if (!body.userId || !body.text) {
      return c.json({ error: "userId and text are required" }, 400);
    }

    try {
      await sendText({
        userId: body.userId,
        text: body.text,
        accountId: body.accountId,
      });
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(`[http] server running on http://localhost:${port}`);
  });

  return server;
}
