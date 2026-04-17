import { PuppeteerCrawler, RequestQueue } from "crawlee";

import { BaseCollector, type CollectorExecution } from "./base.collector.ts";
import { autoScroll, sleep } from "./utils/puppeteer.utils.ts";
import { extractExternalId, parseCompactNumber } from "./utils/text.utils.ts";
import type { CrawlTask, ProductSeed, RawFeedbackItem } from "../types/crawl.types.ts";

interface InstagramPostData {
  caption?: string;
  author?: string;
  comments: Array<{
    text: string;
    author?: string;
    likes?: string;
  }>;
}

export class InstagramCollector extends BaseCollector {
  readonly platform = "instagram" as const;

  protected async collectInternal(task: CrawlTask): Promise<CollectorExecution> {
    const seeded = task.options?.startUrls ?? this.buildStartUrls(task.product);

    if (seeded.length === 0) {
      return {
        items: [],
        warnings: ["instagram collector needs hashtags or handles, or options.startUrls"],
      };
    }

    const queue = await RequestQueue.open(`instagram-${task.runId}-${Date.now()}`);
    const warnings: string[] = [];
    const items: RawFeedbackItem[] = [];
    const seenPostUrls = new Set<string>();
    const maxScrollSteps = task.options?.maxScrollSteps ?? 6;

    for (const url of seeded) {
      await queue.addRequest({
        url,
        userData: {
          pageType: url.includes("/p/") ? "post" : "feed",
        },
      });
    }

    const crawler = new PuppeteerCrawler({
      requestQueue: queue,
      maxRequestsPerCrawl: this.maxRequests(task),
      requestHandlerTimeoutSecs: 120,
      launchContext: {
        launchOptions: {
          headless: true,
        },
      },
      requestHandler: async ({ page, request }) => {
        const pageType = String(request.userData.pageType ?? "feed");
        await sleep(1_500);

        if (pageType !== "post") {
          await autoScroll(page, maxScrollSteps);
          const links = (await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='/p/']"));
            const hrefs = anchors.map((anchor) => anchor.href).filter(Boolean);
            return Array.from(new Set(hrefs)).slice(0, 30);
          })) as string[];

          for (const href of links) {
            const normalized = this.normalizePostUrl(href);
            if (seenPostUrls.has(normalized)) {
              continue;
            }

            seenPostUrls.add(normalized);
            await queue.addRequest({
              url: normalized,
              userData: {
                pageType: "post",
              },
            });
          }

          return;
        }

        await page.waitForSelector("article", { timeout: 15_000 }).catch(() => undefined);
        await autoScroll(page, Math.max(3, Math.floor(maxScrollSteps / 2)));

        const payload = (await page.evaluate(() => {
          const captionNode =
            document.querySelector("article h1") ??
            document.querySelector("article ul li div > div > div > span");
          const caption = captionNode?.textContent?.trim();
          const author = document.querySelector("header a")?.textContent?.trim();
          const comments = Array.from(document.querySelectorAll("article ul ul li"))
            .slice(0, 80)
            .map((node) => {
              const authorNode = node.querySelector("h3, a");
              const spans = Array.from(node.querySelectorAll("span"));
              const text = spans.map((span) => span.textContent ?? "").join(" ").trim();
              const likes = node.querySelector("button span")?.textContent?.trim();
              return {
                text,
                author: authorNode?.textContent?.trim(),
                likes,
              };
            });

          return { caption, author, comments };
        })) as InstagramPostData;

        const pageUrl = request.loadedUrl ?? request.url;
        if (payload.caption && this.matchesProduct(payload.caption, task.product)) {
          items.push(
            this.createItem(
              task,
              {
                sourceUrl: pageUrl,
                text: payload.caption,
                author: payload.author,
                externalId: extractExternalId(pageUrl, "ig-post"),
                metadata: {
                  pageType: "post-caption",
                },
              },
              items.length,
            ),
          );
        }

        for (const [index, comment] of payload.comments.entries()) {
          if (comment.text.length < 8 || !this.matchesProduct(comment.text, task.product)) {
            continue;
          }

          items.push(
            this.createItem(
              task,
              {
                sourceUrl: `${pageUrl}#comment-${index + 1}`,
                text: comment.text,
                author: comment.author,
                externalId: extractExternalId(pageUrl, "ig-comment"),
                engagement: {
                  likes: parseCompactNumber(comment.likes),
                },
                metadata: {
                  pageType: "comment",
                },
              },
              items.length,
            ),
          );
        }
      },
      failedRequestHandler: async ({ request }) => {
        warnings.push(`instagram collector failed: ${request.url}`);
      },
    });

    await crawler.run();
    return { items, warnings };
  }

  private buildStartUrls(product: ProductSeed): string[] {
    const urls = new Set<string>();

    for (const hashtag of product.hashtags ?? []) {
      const tag = hashtag.replace(/^#/, "").trim();
      if (!tag) {
        continue;
      }

      urls.add(`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`);
    }

    for (const handle of product.socialHandles ?? []) {
      const username = handle.replace(/^@/, "").trim();
      if (!username) {
        continue;
      }

      urls.add(`https://www.instagram.com/${encodeURIComponent(username)}/`);
    }

    if (urls.size === 0) {
      for (const keyword of product.keywords ?? []) {
        const tag = keyword.replace(/^#/, "").trim().replace(/\s+/g, "");
        if (!tag) {
          continue;
        }

        urls.add(`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`);
      }
    }

    return [...urls];
  }

  private normalizePostUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const postIndex = segments.findIndex((segment) => segment === "p" || segment === "reel");
      if (postIndex >= 0 && segments[postIndex + 1]) {
        return `https://www.instagram.com/${segments[postIndex]}/${segments[postIndex + 1]}/`;
      }
      return url;
    } catch {
      return url;
    }
  }
}
