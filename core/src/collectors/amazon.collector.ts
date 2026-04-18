import { CheerioCrawler, RequestQueue } from "crawlee";

import { BaseCollector, type CollectorExecution } from "./base.collector.ts";
import { parseCompactNumber } from "./utils/text.utils.ts";
import type { CrawlTask, RawFeedbackItem } from "../types/crawl.types.ts";

export class AmazonCollector extends BaseCollector {
  readonly platform = "amazon" as const;

  protected async collectInternal(task: CrawlTask): Promise<CollectorExecution> {
    const terms = this.getSearchTerms(task.product);
    const seeded =
      task.options?.startUrls ??
      terms.slice(0, 3).map((term) => `https://www.amazon.com/s?k=${encodeURIComponent(term)}`);

    if (seeded.length === 0) {
      return {
        items: [],
        warnings: ["amazon collector could not build any search URL"],
      };
    }

    const queue = await RequestQueue.open(`amazon-${task.runId}-${Date.now()}`);
    const warnings: string[] = [];
    const items: RawFeedbackItem[] = [];
    const seenReviewUrls = new Set<string>();

    for (const url of seeded) {
      await queue.addRequest({
        url,
        userData: { pageType: "search" },
      });
    }

    const crawler = new CheerioCrawler({
      requestQueue: queue,
      maxRequestsPerCrawl: this.maxRequests(task),
      requestHandlerTimeoutSecs: 45,
      requestHandler: async ({ $, request }) => {
        const pageType = String(request.userData.pageType ?? "search");

        if (pageType === "search") {
          const productLinks = $("a.a-link-normal.s-no-outline, a.a-link-normal.s-line-clamp-2")
            .map((_, element) => $(element).attr("href"))
            .get()
            .filter((href): href is string => Boolean(href));

          for (const href of productLinks) {
            const productUrl = this.resolveUrl(href, request.loadedUrl ?? request.url);
            const asin = this.extractAsin(productUrl);
            if (!asin) {
              continue;
            }

            const reviewsUrl = `https://www.amazon.com/product-reviews/${asin}`;
            if (seenReviewUrls.has(reviewsUrl)) {
              continue;
            }

            seenReviewUrls.add(reviewsUrl);
            await queue.addRequest({
              url: reviewsUrl,
              userData: { pageType: "reviews", asin },
            });
          }

          return;
        }

        $("[data-hook='review']").each((_, element) => {
          const node = $(element);
          const title = node.find("[data-hook='review-title']").text().trim();
          const text = node.find("[data-hook='review-body']").text().trim();
          const author = node.find(".a-profile-name").first().text().trim();
          const postedAt = node.find("[data-hook='review-date']").text().trim();
          const ratingLabel = node.find("[data-hook='review-star-rating']").first().text().trim();
          const helpfulLabel = node.find("[data-hook='helpful-vote-statement']").first().text().trim();
          const sourceUrl = request.loadedUrl ?? request.url;

          const joined = `${title} ${text}`.trim();
          if (joined.length < 35 || !this.matchesProduct(joined, task.product)) {
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
                text: joined,
                author: author || undefined,
                postedAt: postedAt || undefined,
                engagement: {
                  likes: parseCompactNumber(helpfulLabel),
                },
                metadata: {
                  ratingLabel,
                  asin: request.userData.asin,
                },
              },
              items.length,
            ),
          );
        });
      },
      failedRequestHandler: async ({ request }) => {
        warnings.push(`amazon collector failed: ${request.url}`);
      },
    });

    await crawler.run();
    return { items, warnings };
  }

  private resolveUrl(href: string, baseUrl: string): string {
    try {
      if (href.startsWith("http://") || href.startsWith("https://")) {
        return href;
      }

      return new URL(href, baseUrl).toString();
    } catch {
      return href;
    }
  }

  private extractAsin(url: string): string | null {
    const match = url.match(/\/([A-Z0-9]{10})(?:[/?]|$)/i);
    return match?.[1] ?? null;
  }
}
