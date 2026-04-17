import { CheerioCrawler, EnqueueStrategy, RequestQueue } from "crawlee";

import { BaseCollector, type CollectorExecution } from "./base.collector.ts";
import type { CrawlTask, RawFeedbackItem } from "../types/crawl.types.ts";

export class WebCollector extends BaseCollector {
  readonly platform = "web" as const;

  protected async collectInternal(task: CrawlTask): Promise<CollectorExecution> {
    const startUrls = task.options?.startUrls ?? [];
    if (startUrls.length === 0) {
      return {
        items: [],
        warnings: ["web collector needs options.startUrls"],
      };
    }

    const items: RawFeedbackItem[] = [];
    const warnings: string[] = [];
    const queue = await RequestQueue.open(`web-${task.runId}-${Date.now()}`);

    for (const url of startUrls) {
      await queue.addRequest({
        url,
        uniqueKey: `seed-${url}`,
      });
    }

    const crawler = new CheerioCrawler({
      requestQueue: queue,
      maxRequestsPerCrawl: this.maxRequests(task),
      requestHandlerTimeoutSecs: 45,
      requestHandler: async ({ $, request, enqueueLinks }) => {
        const title = $("title").first().text().trim();
        const articleText = $("article").text().trim();
        const bodyText = $("body").text().trim();
        const text = articleText.length > 120 ? articleText : bodyText;

        if (text.length > 80 && this.matchesProduct(`${title} ${text}`, task.product)) {
          items.push(
            this.createItem(
              task,
              {
                sourceUrl: request.loadedUrl ?? request.url,
                title: title || undefined,
                text,
                metadata: {
                  pageType: request.userData.pageType ?? "seed",
                },
              },
              items.length,
            ),
          );
        }

        const nextLimit = Math.max(0, this.maxRequests(task) - items.length);
        if (nextLimit > 0) {
          await enqueueLinks({
            strategy: EnqueueStrategy.SameHostname,
            limit: Math.min(10, nextLimit),
            globs: ["http://**", "https://**"],
            transformRequestFunction: (requestOptions) => ({
              ...requestOptions,
              userData: {
                ...requestOptions.userData,
                pageType: "detail",
              },
            }),
          });
        }
      },
      failedRequestHandler: async ({ request }) => {
        warnings.push(`web collector failed: ${request.url}`);
      },
    });

    await crawler.run();
    return { items, warnings };
  }
}
