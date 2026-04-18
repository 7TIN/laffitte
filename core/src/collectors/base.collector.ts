import type {
  CollectorResult,
  CrawlTask,
  Platform,
  ProductSeed,
  RawFeedbackItem,
} from "../types/crawl.types.ts";
import {
  buildSearchTerms,
  compactText,
  isWithinDuration,
  matchesAnyProductTerm,
  stableItemId,
} from "./utils/text.utils.ts";

export interface CollectorExecution {
  items: RawFeedbackItem[];
  warnings?: string[];
}

export interface RawFeedbackDraft {
  sourceUrl: string;
  text: string;
  title?: string | undefined;
  author?: string | undefined;
  postedAt?: string | undefined;
  externalId?: string | undefined;
  engagement?: RawFeedbackItem["engagement"] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export abstract class BaseCollector {
  abstract readonly platform: Platform;

  protected readonly defaultMaxItems = 100;
  protected readonly defaultMaxRequestsPerCrawl = 30;

  async collect(task: CrawlTask): Promise<CollectorResult> {
    const execution = await this.collectInternal(task);
    const maxItems = task.options?.maxItems ?? this.defaultMaxItems;
    const deduped = this.dedupeItems(execution.items).slice(0, maxItems);

    return {
      runId: task.runId,
      platform: this.platform,
      totalCollected: deduped.length,
      items: deduped,
      warnings: execution.warnings ?? [],
    };
  }

  protected abstract collectInternal(task: CrawlTask): Promise<CollectorExecution>;

  protected getSearchTerms(product: ProductSeed): string[] {
    return buildSearchTerms(product);
  }

  protected matchesProduct(text: string, product: ProductSeed): boolean {
    return matchesAnyProductTerm(text, product);
  }

  protected maxRequests(task: CrawlTask): number {
    return task.options?.maxRequestsPerCrawl ?? this.defaultMaxRequestsPerCrawl;
  }

  protected withinDuration(task: CrawlTask, postedAt: string | null | undefined): boolean {
    return isWithinDuration(postedAt, task.options?.durationHours);
  }

  protected createItem(task: CrawlTask, draft: RawFeedbackDraft, index: number): RawFeedbackItem {
    const text = compactText(draft.text);

    return {
      id: stableItemId(task.runId, this.platform, draft.sourceUrl, text, index),
      runId: task.runId,
      platform: this.platform,
      sourceUrl: draft.sourceUrl,
      text,
      title: draft.title,
      author: draft.author,
      postedAt: draft.postedAt,
      externalId: draft.externalId,
      collectedAt: new Date().toISOString(),
      engagement: draft.engagement,
      metadata: draft.metadata ?? {},
    };
  }

  protected getCheerioPreNavigationHooks(): Array<(context: unknown, gotOptions: unknown) => Promise<void>> {
    return [
      async (_context, gotOptions) => {
        const options = gotOptions as Record<string, unknown>;

        // Bun + got-scraping can fail TLS negotiation with generated cipher lists.
        options.http2 = false;
        options.useHeaderGenerator = false;
        delete options.ciphers;

        const https =
          typeof options.https === "object" && options.https !== null
            ? ({ ...(options.https as Record<string, unknown>) } as Record<string, unknown>)
            : {};
        delete https.ciphers;
        options.https = https;
      },
    ];
  }

  private dedupeItems(items: RawFeedbackItem[]): RawFeedbackItem[] {
    const unique = new Map<string, RawFeedbackItem>();
    for (const item of items) {
      const key = `${item.sourceUrl}|${item.text.slice(0, 120)}`;
      if (!unique.has(key)) {
        unique.set(key, item);
      }
    }

    return [...unique.values()];
  }
}
