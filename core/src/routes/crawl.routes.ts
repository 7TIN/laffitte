import { Hono } from "hono";

import { listPlatforms } from "../collectors/index.ts";
import { CollectorOrchestrator } from "../orchestrator/collector.orchestrator.ts";
import type {
  CollectorOptions,
  CrawlRunTask,
  Platform,
  ProductSeed,
} from "../types/crawl.types.ts";

const crawlRoutes = new Hono();
const orchestrator = new CollectorOrchestrator();

crawlRoutes.get("/platforms", (c) => {
  return c.json({
    platforms: listPlatforms(),
  });
});

crawlRoutes.post("/platform/:platform", async (c) => {
  const platform = c.req.param("platform");
  if (!isPlatform(platform)) {
    return c.json(
      {
        error: `unsupported platform "${platform}"`,
        supportedPlatforms: listPlatforms(),
      },
      400,
    );
  }

  const body = await safeJsonBody(c);
  if (!body) {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const product = parseProductSeed(body.product ?? body);
  if (!product) {
    return c.json({ error: "body.product.productName is required" }, 400);
  }

  const result = await orchestrator.runSingle({
    runId: getRunId(body.runId),
    platform,
    product,
    options: parseCollectorOptions(body.options),
  });

  return c.json(result);
});

crawlRoutes.post("/run", async (c) => {
  const body = await safeJsonBody(c);
  if (!body) {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const product = parseProductSeed(body.product);
  if (!product) {
    return c.json({ error: "body.product.productName is required" }, 400);
  }

  const platforms = parsePlatforms(body.platforms);
  if (platforms.length === 0) {
    return c.json(
      {
        error: "body.platforms must include at least one supported platform",
        supportedPlatforms: listPlatforms(),
      },
      400,
    );
  }

  const optionsByPlatform = parseOptionsByPlatform(body.optionsByPlatform);
  const task: CrawlRunTask = {
    runId: getRunId(body.runId),
    product,
    platforms,
    optionsByPlatform,
  };

  const result = await orchestrator.run(task);
  return c.json(result);
});

function isPlatform(value: string): value is Platform {
  return listPlatforms().includes(value as Platform);
}

function parsePlatforms(value: unknown): Platform[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is Platform => typeof entry === "string" && isPlatform(entry));
}

function parseProductSeed(value: unknown): ProductSeed | null {
  if (!isObject(value)) {
    return null;
  }

  if (typeof value.productName !== "string" || value.productName.trim().length === 0) {
    return null;
  }

  return {
    productName: value.productName.trim(),
    aliases: asStringArray(value.aliases),
    socialHandles: asStringArray(value.socialHandles),
    hashtags: asStringArray(value.hashtags),
    keywords: asStringArray(value.keywords),
  };
}

function parseOptionsByPlatform(value: unknown): Partial<Record<Platform, CollectorOptions>> | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const parsed: Partial<Record<Platform, CollectorOptions>> = {};
  for (const platform of listPlatforms()) {
    const raw = value[platform];
    const options = parseCollectorOptions(raw);
    if (options) {
      parsed[platform] = options;
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseCollectorOptions(value: unknown): CollectorOptions | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const options: CollectorOptions = {};
  if (typeof value.maxItems === "number") {
    options.maxItems = value.maxItems;
  }
  if (typeof value.maxRequestsPerCrawl === "number") {
    options.maxRequestsPerCrawl = value.maxRequestsPerCrawl;
  }
  if (typeof value.includeReplies === "boolean") {
    options.includeReplies = value.includeReplies;
  }
  if (typeof value.maxScrollSteps === "number") {
    options.maxScrollSteps = value.maxScrollSteps;
  }
  if (typeof value.locale === "string") {
    options.locale = value.locale;
  }
  if (Array.isArray(value.startUrls)) {
    options.startUrls = value.startUrls.filter((entry): entry is string => typeof entry === "string");
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function safeJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await c.req.json();
    if (!isObject(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function getRunId(input: unknown): string {
  if (typeof input === "string" && input.trim().length > 0) {
    return input.trim();
  }

  return `run-${Date.now()}`;
}

export { crawlRoutes };

