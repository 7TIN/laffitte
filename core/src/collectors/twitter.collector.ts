import { PuppeteerCrawler, RequestQueue } from "crawlee";

import { BaseCollector, type CollectorExecution } from "./base.collector.ts";
import { autoScroll } from "./utils/puppeteer.utils.ts";
import { extractExternalId, parseCompactNumber } from "./utils/text.utils.ts";
import type { CrawlTask, RawFeedbackItem } from "../types/crawl.types.ts";

interface TwitterDomItem {
  text: string;
  author?: string;
  statusUrl?: string;
  postedAt?: string;
  likes?: string;
  replies?: string;
  reposts?: string;
}

export class TwitterCollector extends BaseCollector {
  readonly platform = "twitter" as const;

  protected async collectInternal(task: CrawlTask): Promise<CollectorExecution> {
    const terms = this.getSearchTerms(task.product);
    const query = terms.slice(0, 3).join(" OR ");
    const startUrls =
      task.options?.startUrls ??
      (query.length > 0
        ? [`https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`]
        : []);

    if (startUrls.length === 0) {
      return {
        items: [],
        warnings: ["twitter collector could not build any search URL"],
      };
    }

    const queue = await RequestQueue.open(`twitter-${task.runId}-${Date.now()}`);
    const warnings: string[] = [];
    const items: RawFeedbackItem[] = [];
    const seenDetailUrls = new Set<string>();
    const includeReplies = task.options?.includeReplies ?? true;
    const maxScrollSteps = task.options?.maxScrollSteps ?? 6;

    for (const url of startUrls) {
      await queue.addRequest({
        url,
        userData: { pageType: "search" },
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
        const pageType = String(request.userData.pageType ?? "search");

        await page.waitForTimeout(1_200);
        await autoScroll(page, maxScrollSteps);

        const domItems = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll("article[data-testid='tweet']"));
          return cards.slice(0, 35).map((card) => {
            const text = Array.from(card.querySelectorAll("div[data-testid='tweetText'] span"))
              .map((node) => node.textContent ?? "")
              .join(" ")
              .trim();
            const author = card.querySelector("div[data-testid='User-Name'] span")?.textContent?.trim();
            const statusAnchor = card.querySelector<HTMLAnchorElement>("a[href*='/status/']");
            const statusUrl = statusAnchor?.href;
            const postedAt = card.querySelector("time")?.getAttribute("datetime") ?? undefined;
            const likes = card.querySelector("button[data-testid='like'] span")?.textContent ?? undefined;
            const replies = card.querySelector("button[data-testid='reply'] span")?.textContent ?? undefined;
            const reposts = card.querySelector("button[data-testid='retweet'] span")?.textContent ?? undefined;
            return { text, author, statusUrl, postedAt, likes, replies, reposts };
          });
        });

        for (const domItem of domItems as TwitterDomItem[]) {
          if (domItem.text.length < 20 || !this.matchesProduct(domItem.text, task.product)) {
            continue;
          }

          const sourceUrl = this.resolveUrl(domItem.statusUrl, request.loadedUrl ?? request.url);
          items.push(
            this.createItem(
              task,
              {
                sourceUrl,
                text: domItem.text,
                author: domItem.author,
                postedAt: domItem.postedAt,
                externalId: extractExternalId(sourceUrl, "tweet"),
                engagement: {
                  likes: parseCompactNumber(domItem.likes),
                  replies: parseCompactNumber(domItem.replies),
                  shares: parseCompactNumber(domItem.reposts),
                },
                metadata: {
                  pageType,
                },
              },
              items.length,
            ),
          );
        }

        if (!includeReplies || pageType !== "search") {
          return;
        }

        const detailUrls = (domItems as TwitterDomItem[])
          .map((domItem) => domItem.statusUrl)
          .filter((value): value is string => Boolean(value))
          .slice(0, 10);

        for (const detailUrl of detailUrls) {
          const url = this.resolveUrl(detailUrl, request.loadedUrl ?? request.url);
          if (seenDetailUrls.has(url)) {
            continue;
          }

          seenDetailUrls.add(url);
          await queue.addRequest({
            url,
            userData: { pageType: "detail" },
          });
        }
      },
      failedRequestHandler: async ({ request }) => {
        warnings.push(`twitter collector failed: ${request.url}`);
      },
    });

    await crawler.run();
    return { items, warnings };
  }

  private resolveUrl(candidate: string | undefined, baseUrl: string): string {
    if (!candidate) {
      return baseUrl;
    }

    try {
      if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
        return candidate;
      }

      return new URL(candidate, baseUrl).toString();
    } catch {
      return baseUrl;
    }
  }
}
