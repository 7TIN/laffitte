import { PuppeteerCrawler, RequestQueue } from "crawlee";

import { BaseCollector, type CollectorExecution } from "./base.collector.ts";
import { autoScroll, sleep } from "./utils/puppeteer.utils.ts";
import { extractExternalId, parseCompactNumber } from "./utils/text.utils.ts";
import type { CrawlTask, RawFeedbackItem } from "../types/crawl.types.ts";

interface YouTubePageData {
  videoTitle?: string;
  videoDescription?: string;
  comments: Array<{
    text: string;
    author?: string;
    postedAt?: string;
    likes?: string;
  }>;
}

export class YouTubeCollector extends BaseCollector {
  readonly platform = "youtube" as const;

  protected async collectInternal(task: CrawlTask): Promise<CollectorExecution> {
    const terms = this.getSearchTerms(task.product);
    const query = terms.slice(0, 3).join(" ");
    const startUrls =
      task.options?.startUrls ??
      (query.length > 0 ? [`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`] : []);

    if (startUrls.length === 0) {
      return {
        items: [],
        warnings: ["youtube collector could not build any search URL"],
      };
    }

    const queue = await RequestQueue.open(`youtube-${task.runId}-${Date.now()}`);
    const warnings: string[] = [];
    const items: RawFeedbackItem[] = [];
    const seenVideoUrls = new Set<string>();
    const maxScrollSteps = task.options?.maxScrollSteps ?? 8;

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
        if (pageType === "search") {
          await page.waitForSelector("a#video-title", { timeout: 20_000 }).catch(() => undefined);
          await autoScroll(page, Math.max(4, maxScrollSteps - 2));

          const videos = (await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a#video-title"));
            return anchors.slice(0, 20).map((anchor) => {
              const href = anchor.href;
              const title = anchor.textContent?.trim() ?? "";
              const channel = anchor.closest("ytd-video-renderer")?.querySelector("#channel-name a")?.textContent?.trim();
              return { href, title, channel };
            });
          })) as Array<{ href: string; title: string; channel?: string }>;

          for (const video of videos) {
            if (!video.href) {
              continue;
            }

            const url = this.normalizeWatchUrl(video.href);
            if (seenVideoUrls.has(url)) {
              continue;
            }

            seenVideoUrls.add(url);

            if (this.matchesProduct(`${video.title} ${video.channel ?? ""}`, task.product)) {
              items.push(
                this.createItem(
                  task,
                  {
                    sourceUrl: url,
                    title: video.title || undefined,
                    text: `${video.title} ${video.channel ?? ""}`.trim(),
                    author: video.channel,
                    externalId: extractExternalId(url, "yt-video"),
                    metadata: {
                      pageType: "search-video",
                    },
                  },
                  items.length,
                ),
              );
            }

            await queue.addRequest({
              url,
              userData: {
                pageType: "video",
                title: video.title,
                channel: video.channel,
              },
            });
          }

          return;
        }

        await sleep(1_200);
        await autoScroll(page, maxScrollSteps);
        await page.waitForSelector("ytd-comments", { timeout: 20_000 }).catch(() => undefined);
        await autoScroll(page, Math.max(4, Math.floor(maxScrollSteps / 2)));

        const payload = (await page.evaluate(() => {
          const videoTitle = document.querySelector("h1.ytd-watch-metadata")?.textContent?.trim();
          const videoDescription = document.querySelector("#description-inline-expander")?.textContent?.trim();
          const comments = Array.from(document.querySelectorAll("ytd-comment-thread-renderer"))
            .slice(0, 80)
            .map((node) => {
              const text = node.querySelector("#content-text")?.textContent?.trim() ?? "";
              const author = node.querySelector("#author-text span")?.textContent?.trim();
              const postedAt = node.querySelector("a[href*='lc=']")?.textContent?.trim();
              const likes = node.querySelector("#vote-count-middle")?.textContent?.trim();
              return { text, author, postedAt, likes };
            });

          return {
            videoTitle,
            videoDescription,
            comments,
          };
        })) as YouTubePageData;

        const pageUrl = request.loadedUrl ?? request.url;
        const contextText = `${payload.videoTitle ?? ""} ${payload.videoDescription ?? ""}`.trim();
        if (contextText.length > 20 && this.matchesProduct(contextText, task.product)) {
          items.push(
            this.createItem(
              task,
              {
                sourceUrl: pageUrl,
                title: payload.videoTitle ?? undefined,
                text: contextText,
                author: (request.userData.channel as string | undefined) ?? undefined,
                externalId: extractExternalId(pageUrl, "yt-video"),
                metadata: {
                  pageType: "video-context",
                },
              },
              items.length,
            ),
          );
        }

        for (const [index, comment] of payload.comments.entries()) {
          if (comment.text.length < 10 || !this.matchesProduct(comment.text, task.product)) {
            continue;
          }

          if (!this.withinDuration(task, comment.postedAt)) {
            continue;
          }

          items.push(
            this.createItem(
              task,
              {
                sourceUrl: `${pageUrl}#comment-${index + 1}`,
                text: comment.text,
                author: comment.author,
                postedAt: comment.postedAt,
                externalId: extractExternalId(pageUrl, "yt-comment"),
                engagement: {
                  likes: parseCompactNumber(comment.likes),
                },
                metadata: {
                  pageType: "comment",
                  videoTitle: payload.videoTitle,
                },
              },
              items.length,
            ),
          );
        }
      },
      failedRequestHandler: async ({ request }) => {
        warnings.push(`youtube collector failed: ${request.url}`);
      },
    });

    await crawler.run();
    return { items, warnings };
  }

  private normalizeWatchUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.pathname !== "/watch") {
        return url;
      }

      const id = parsed.searchParams.get("v");
      if (!id) {
        return url;
      }

      return `https://www.youtube.com/watch?v=${id}`;
    } catch {
      return url;
    }
  }
}
