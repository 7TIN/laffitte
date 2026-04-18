import { CheerioCrawler, RequestQueue } from "crawlee";

import { BaseCollector, type CollectorExecution } from "./base.collector.ts";
import type { CrawlTask, RawFeedbackItem } from "../types/crawl.types.ts";

export class NewsCollector extends BaseCollector {
  readonly platform = "news" as const;

  protected async collectInternal(task: CrawlTask): Promise<CollectorExecution> {
    const terms = this.getSearchTerms(task.product);
    const seeded = task.options?.startUrls ?? this.buildSearchUrls(terms, task.options?.locale);

    if (seeded.length === 0) {
      return {
        items: [],
        warnings: ["news collector could not build any search URL"],
      };
    }

    const queue = await RequestQueue.open(`news-${task.runId}-${Date.now()}`);
    const warnings: string[] = [];
    const items: RawFeedbackItem[] = [];

    for (const url of seeded) {
      await queue.addRequest({ url });
    }

    const crawler = new CheerioCrawler({
      requestQueue: queue,
      maxRequestsPerCrawl: this.maxRequests(task),
      requestHandlerTimeoutSecs: 45,
      preNavigationHooks: this.getCheerioPreNavigationHooks(),
      requestHandler: async ({ $, request }) => {
        const cards = $("article");
        if (cards.length === 0) {
          const fallbackTitle = $("h1, h2, h3").first().text().trim();
          const fallbackText = $("body").text().trim();
          if (fallbackText.length > 120 && this.matchesProduct(`${fallbackTitle} ${fallbackText}`, task.product)) {
            items.push(
              this.createItem(
                task,
                {
                  sourceUrl: request.loadedUrl ?? request.url,
                  title: fallbackTitle || undefined,
                  text: fallbackText,
                  metadata: {
                    source: "news-page-fallback",
                  },
                },
                items.length,
              ),
            );
          }

          return;
        }

        cards.each((_, element) => {
          const node = $(element);
          const title = node.find("h3, h4").first().text().trim();
          const snippet = node.find("span").text().trim();
          const postedAt = node.find("time").attr("datetime") ?? node.find("time").text().trim();
          const href = node.find("a").first().attr("href");
          const sourceUrl = this.normalizeUrl(href, request.loadedUrl ?? request.url);
          const text = `${title} ${snippet}`.trim();

          if (!sourceUrl || text.length < 40 || !this.matchesProduct(text, task.product)) {
            return;
          }

          if (!this.withinDuration(task, postedAt)) {
            return;
          }

          items.push(
            this.createItem(
              task,
              {
                sourceUrl,
                title: title || undefined,
                text,
                postedAt: postedAt || undefined,
                metadata: {
                  source: "news.google.com",
                },
              },
              items.length,
            ),
          );
        });
      },
      failedRequestHandler: async ({ request }) => {
        warnings.push(`news collector failed: ${request.url}`);
      },
    });

    await crawler.run();
    return { items, warnings };
  }

  private buildSearchUrls(terms: string[], locale = "en-US"): string[] {
    const selected = terms.slice(0, 4);
    return selected.map((term) => {
      const query = encodeURIComponent(term);
      return `https://news.google.com/search?q=${query}&hl=${locale}&gl=US&ceid=US:en`;
    });
  }

  private normalizeUrl(href: string | undefined, baseUrl: string): string | null {
    if (!href) {
      return null;
    }

    try {
      if (href.startsWith("http://") || href.startsWith("https://")) {
        return href;
      }

      const resolved = new URL(href, baseUrl);
      return resolved.toString();
    } catch {
      return null;
    }
  }
}
