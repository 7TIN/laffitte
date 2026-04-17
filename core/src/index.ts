import { Hono } from "hono";

import { crawlRoutes } from "./routes/crawl.routes.ts";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    name: "product-intel-core",
    status: "ok",
    endpoints: ["/crawl/platforms", "/crawl/platform/:platform", "/crawl/run"],
  }),
);

app.route("/crawl", crawlRoutes);

export type AppType = typeof app;

const port = Number(process.env.PORT ?? 3001);

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`core server listening on http://localhost:${port}`);
