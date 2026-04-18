import type { Platform } from "../types/crawl.types.ts";
import { AmazonCollector } from "./amazon.collector.ts";
import { BaseCollector } from "./base.collector.ts";
import { InstagramCollector } from "./instagram.collector.ts";
import { NewsCollector } from "./news.collector.ts";
import { RedditCollector } from "./reddit.collector.ts";
import { TwitterCollector } from "./twitter.collector.ts";
import { WebCollector } from "./web.collector.ts";
import { YouTubeCollector } from "./youtube.collector.ts";

const collectorMap: Record<Platform, BaseCollector> = {
  web: new WebCollector(),
  news: new NewsCollector(),
  reddit: new RedditCollector(),
  twitter: new TwitterCollector(),
  youtube: new YouTubeCollector(),
  instagram: new InstagramCollector(),
  amazon: new AmazonCollector(),
};

const defaultPlatforms: Platform[] = ["web", "news"];

function isTwitterEnabled(): boolean {
  return process.env.ENABLE_TWITTER === "true";
}

function isRedditEnabled(): boolean {
  return process.env.ENABLE_REDDIT === "true";
}

function isPlatformEnabled(platform: Platform): boolean {
  if (platform === "twitter") {
    return isTwitterEnabled();
  }

  if (platform === "reddit") {
    return isRedditEnabled();
  }

  return true;
}

function disabledReason(platform: Platform): string | null {
  if (platform === "twitter" && !isTwitterEnabled()) {
    return 'twitter collector is disabled by default (X login wall). Set ENABLE_TWITTER=true only if you are using official API/integration.';
  }

  if (platform === "reddit" && !isRedditEnabled()) {
    return "reddit collector is disabled by default because public crawling is frequently blocked/rate-limited. Set ENABLE_REDDIT=true only if you have a compliant integration.";
  }

  return null;
}

export function getCollector(platform: Platform): BaseCollector {
  const reason = disabledReason(platform);
  if (reason) {
    throw new Error(reason);
  }

  return collectorMap[platform];
}

export function listAllPlatforms(): Platform[] {
  return Object.keys(collectorMap) as Platform[];
}

export function listPlatforms(): Platform[] {
  return listAllPlatforms().filter((platform) => isPlatformEnabled(platform));
}

export function listDefaultPlatforms(): Platform[] {
  return defaultPlatforms.filter((platform) => isPlatformEnabled(platform));
}

export function listDisabledPlatforms(): Platform[] {
  return listAllPlatforms().filter((platform) => !isPlatformEnabled(platform));
}

export {
  AmazonCollector,
  BaseCollector,
  InstagramCollector,
  NewsCollector,
  RedditCollector,
  TwitterCollector,
  WebCollector,
  YouTubeCollector,
};
