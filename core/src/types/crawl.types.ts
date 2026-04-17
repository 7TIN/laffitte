export type Platform =
  | "web"
  | "news"
  | "reddit"
  | "twitter"
  | "youtube"
  | "instagram"
  | "amazon";

export interface ProductSeed {
  productName: string;
  aliases?: string[] | undefined;
  socialHandles?: string[] | undefined;
  hashtags?: string[] | undefined;
  keywords?: string[] | undefined;
}

export interface CollectorOptions {
  maxItems?: number | undefined;
  maxRequestsPerCrawl?: number | undefined;
  startUrls?: string[] | undefined;
  includeReplies?: boolean | undefined;
  maxScrollSteps?: number | undefined;
  locale?: string | undefined;
}

export interface CrawlTask {
  runId: string;
  platform: Platform;
  product: ProductSeed;
  options?: CollectorOptions | undefined;
}

export interface CrawlRunTask {
  runId: string;
  product: ProductSeed;
  platforms: Platform[];
  optionsByPlatform?: Partial<Record<Platform, CollectorOptions>> | undefined;
}

export interface RawFeedbackItem {
  id: string;
  runId: string;
  platform: Platform;
  sourceUrl: string;
  title?: string | undefined;
  text: string;
  author?: string | undefined;
  externalId?: string | undefined;
  postedAt?: string | undefined;
  collectedAt: string;
  engagement?: {
    likes?: number | undefined;
    replies?: number | undefined;
    shares?: number | undefined;
    views?: number | undefined;
  } | undefined;
  metadata: Record<string, unknown>;
}

export interface CollectorResult {
  runId: string;
  platform: Platform;
  totalCollected: number;
  items: RawFeedbackItem[];
  warnings: string[];
}

export interface CrawlRunResult {
  runId: string;
  startedAt: string;
  completedAt: string;
  totalItems: number;
  results: CollectorResult[];
}
