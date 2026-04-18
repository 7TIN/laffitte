import { CheerioCrawler, EnqueueStrategy, RequestQueue } from "crawlee";

import { BaseCollector, type CollectorExecution } from "./base.collector.ts";
import type { CrawlTask, RawFeedbackItem } from "../types/crawl.types.ts";

export class WebCollector extends BaseCollector {
  readonly platform = "web" as const;

  protected async collectInternal(task: CrawlTask): Promise<CollectorExecution> {
    const explicitStartUrls = task.options?.startUrls ?? [];
    const generatedSearchUrls =
      explicitStartUrls.length === 0
        ? this.buildSearchUrls(this.getSearchTerms(task.product), task.options?.locale)
        : [];
    const startUrls = explicitStartUrls.length > 0 ? explicitStartUrls : generatedSearchUrls;

    if (startUrls.length === 0) {
      return {
        items: [],
        warnings: [
          "web collector could not build any crawlable URL. Provide options.startUrls or at least one product term.",
        ],
      };
    }

    const items: RawFeedbackItem[] = [];
    const warnings: string[] = [];
    const queue = await RequestQueue.open(`web-${task.runId}-${Date.now()}`);

    for (const url of startUrls) {
      await queue.addRequest({
        url,
        uniqueKey: `seed-${url}`,
        userData: {
          pageType: this.looksLikeSearchUrl(url) ? "search" : "seed",
        },
      });
    }

    const crawler = new CheerioCrawler({
      requestQueue: queue,
      maxRequestsPerCrawl: this.maxRequests(task),
      requestHandlerTimeoutSecs: 45,
      requestHandler: async ({ $, request, enqueueLinks }) => {
        const pageType = String(request.userData.pageType ?? "seed");
        if (pageType === "search") {
          const detailUrls = this.extractSearchResultLinks($, request.loadedUrl ?? request.url);
          if (detailUrls.length === 0) {
            warnings.push(`web collector found no crawlable result links: ${request.loadedUrl ?? request.url}`);
            return;
          }

          for (const detailUrl of detailUrls) {
            await queue.addRequest({
              url: detailUrl,
              uniqueKey: `detail-${detailUrl}`,
              userData: {
                pageType: "detail",
              },
            });
          }

          return;
        }

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
                  pageType,
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

  private buildSearchUrls(terms: string[], locale = "en-US"): string[] {
    return terms.slice(0, 4).map((term) => {
      const query = encodeURIComponent(term);
      return `https://www.google.com/search?q=${query}&hl=${encodeURIComponent(locale)}&num=10`;
    });
  }

  private looksLikeSearchUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      return parsed.hostname.includes("google.") && parsed.pathname === "/search";
    } catch {
      return false;
    }
  }

  private extractSearchResultLinks($: any, baseUrl: string): string[] {
    const links = new Set<string>();
    $("a[href]").each((_index: number, element: unknown) => {
      const href = $(element).attr("href");
      const resolved = this.resolveSearchLink(href, baseUrl);
      if (!resolved || this.shouldSkipCandidate(resolved)) {
        return;
      }

      links.add(resolved);
    });

    return [...links].slice(0, 20);
  }

  private resolveSearchLink(href: string | undefined, baseUrl: string): string | null {
    if (!href) {
      return null;
    }

    try {
      if (href.startsWith("/url?")) {
        const redirected = new URL(`https://www.google.com${href}`);
        const target = redirected.searchParams.get("q");
        return target && /^https?:\/\//.test(target) ? target : null;
      }

      if (href.startsWith("http://") || href.startsWith("https://")) {
        return href;
      }

      const resolved = new URL(href, baseUrl);
      if (resolved.pathname === "/url") {
        const target = resolved.searchParams.get("q");
        if (target && /^https?:\/\//.test(target)) {
          return target;
        }
      }

      return resolved.toString();
    } catch {
      return null;
    }
  }

  private shouldSkipCandidate(value: string): boolean {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return true;
      }

      const hostname = parsed.hostname.toLowerCase();
      return (
        hostname.includes("google.") ||
        hostname.endsWith("gstatic.com") ||
        hostname.endsWith("googleusercontent.com")
      );
    } catch {
      return true;
    }
  }
}
