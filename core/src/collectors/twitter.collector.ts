import { PuppeteerCrawler, RequestQueue } from "crawlee";

import { BaseCollector, type CollectorExecution } from "./base.collector.ts";
import { autoScroll, sleep } from "./utils/puppeteer.utils.ts";
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
    const query = this.buildSearchQuery(terms, task.options?.durationHours);
    const startUrls = task.options?.startUrls ?? (query.length > 0 ? [this.buildSearchUrl(query)] : []);

    if (startUrls.length === 0) {
      return {
        items: [],
        warnings: ["twitter collector needs at least one search term (product/keywords) or options.startUrls"],
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

        await sleep(1_200);
        await autoScroll(page, maxScrollSteps);

        const domItems = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll("article[data-testid='tweet']"));
          const extractText = (card: Element): string => {
            const direct = card.querySelector("div[data-testid='tweetText']")?.textContent?.trim();
            if (direct && direct.length > 0) {
              return direct;
            }

            const languageNodes = Array.from(card.querySelectorAll("[lang]"))
              .map((node) => node.textContent ?? "")
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            if (languageNodes.length > 0) {
              return languageNodes;
            }

            return ((card as HTMLElement).innerText ?? "")
              .replace(/\s+/g, " ")
              .trim();
          };

          return cards.slice(0, 45).map((card) => {
            const text = extractText(card);
            const author =
              card.querySelector("div[data-testid='User-Name'] span")?.textContent?.trim() ??
              card.querySelector("a[role='link'][href*='/status/']")?.getAttribute("href")?.split("/")[1];
            const statusAnchor = card.querySelector<HTMLAnchorElement>("a[href*='/status/']");
            const statusUrl = statusAnchor?.href;
            const postedAt = card.querySelector("time")?.getAttribute("datetime") ?? undefined;
            const likes =
              card.querySelector("[data-testid='like']")?.textContent?.trim() ?? undefined;
            const replies =
              card.querySelector("[data-testid='reply']")?.textContent?.trim() ?? undefined;
            const reposts =
              card.querySelector("[data-testid='retweet']")?.textContent?.trim() ?? undefined;
            return { text, author, statusUrl, postedAt, likes, replies, reposts };
          });
        });

        if (domItems.length === 0) {
          const maybeLoginWall = await page.evaluate(() =>
            document.body?.innerText?.toLowerCase().includes("log in") ?? false,
          );
          warnings.push(
            maybeLoginWall
              ? `twitter collector hit login wall: ${request.loadedUrl ?? request.url}`
              : `twitter collector found no visible tweet cards: ${request.loadedUrl ?? request.url}`,
          );
        }

        for (const domItem of domItems as TwitterDomItem[]) {
          const normalizedText = domItem.text.replace(/\s+/g, " ").trim();
          if (normalizedText.length < 8) {
            continue;
          }

          if (!this.withinDuration(task, domItem.postedAt)) {
            continue;
          }

          const sourceUrl = this.resolveUrl(domItem.statusUrl, request.loadedUrl ?? request.url);
          items.push(
            this.createItem(
              task,
              {
                sourceUrl,
                text: normalizedText,
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
    if (items.length === 0) {
      warnings.push(
        "twitter collector returned 0 items; if this keeps happening, X is likely rate-limited/login-gated for unauthenticated crawling.",
      );
    }

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

  private buildSearchQuery(terms: string[], durationHours: number | undefined): string {
    const filteredTerms = terms
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .slice(0, 5)
      .map((value) => (/\s/.test(value) ? `"${value}"` : value));

    if (filteredTerms.length === 0) {
      return "";
    }

    const parts: string[] = [filteredTerms.join(" OR "), "-is:retweet"];

    const sinceDate = this.buildSinceDate(durationHours);
    if (sinceDate) {
      parts.push(`since:${sinceDate}`);
    }

    return parts.join(" ").trim();
  }

  private buildSearchUrl(query: string): string {
    return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
  }

  private buildSinceDate(durationHours: number | undefined): string | undefined {
    if (!durationHours || durationHours <= 0) {
      return undefined;
    }

    const since = new Date(Date.now() - durationHours * 3_600_000);
    return since.toISOString().slice(0, 10);
  }
}
