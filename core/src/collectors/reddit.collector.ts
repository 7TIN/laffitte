import { CheerioCrawler, RequestQueue } from "crawlee";

import { BaseCollector, type CollectorExecution } from "./base.collector.ts";
import type { CrawlTask, RawFeedbackItem } from "../types/crawl.types.ts";

export class RedditCollector extends BaseCollector {
  readonly platform = "reddit" as const;

  protected async collectInternal(task: CrawlTask): Promise<CollectorExecution> {
    const terms = this.getSearchTerms(task.product);
    const seeded =
      task.options?.startUrls ??
      terms.slice(0, 4).map((term) => `https://old.reddit.com/search?q=${encodeURIComponent(term)}&sort=new&t=week`);

    if (seeded.length === 0) {
      return {
        items: [],
        warnings: ["reddit collector could not build any search URL"],
      };
    }

    const queue = await RequestQueue.open(`reddit-${task.runId}-${Date.now()}`);
    const warnings: string[] = [];
    const items: RawFeedbackItem[] = [];
    const seenCommentPages = new Set<string>();

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
          $(".search-result").each((_, element) => {
            const node = $(element);
            const title = node.find(".search-title").first().text().trim();
            const text = node.find(".search-result-body").text().trim();
            const author = node.find(".search-author").first().text().trim();
            const sourceUrl = node.find(".search-title").attr("href") ?? request.loadedUrl ?? request.url;
            const combined = `${title} ${text}`.trim();

            if (combined.length < 40 || !this.matchesProduct(combined, task.product)) {
              return;
            }

            items.push(
              this.createItem(
                task,
                {
                  sourceUrl,
                  title: title || undefined,
                  text: combined,
                  author: author || undefined,
                  metadata: {
                    pageType: "search-result",
                  },
                },
                items.length,
              ),
            );
          });

          const commentLinks = $(".search-comments")
            .map((_, element) => $(element).attr("href"))
            .get()
            .filter((href): href is string => Boolean(href));

          for (const href of commentLinks) {
            if (seenCommentPages.has(href)) {
              continue;
            }

            seenCommentPages.add(href);
            await queue.addRequest({
              url: href,
              userData: { pageType: "comments" },
            });
          }

          return;
        }

        $(".thing.comment").each((_, element) => {
          const node = $(element);
          const text = node.find(".md").text().trim();
          const author = node.find(".author").first().text().trim();
          const postedAt = node.find("time").attr("datetime");
          const sourceUrl = node.find("a.bylink").attr("href") ?? request.loadedUrl ?? request.url;
          if (text.length < 25 || !this.matchesProduct(text, task.product)) {
            return;
          }

          items.push(
            this.createItem(
              task,
              {
                sourceUrl,
                text,
                author: author || undefined,
                postedAt: postedAt || undefined,
                metadata: {
                  pageType: "comment",
                },
              },
              items.length,
            ),
          );
        });
      },
      failedRequestHandler: async ({ request }) => {
        warnings.push(`reddit collector failed: ${request.url}`);
      },
    });

    await crawler.run();
    return { items, warnings };
  }
}
