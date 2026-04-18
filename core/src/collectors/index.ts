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

function isTwitterEnabled(): boolean {
  return process.env.ENABLE_TWITTER === "true";
}

export function getCollector(platform: Platform): BaseCollector {
  if (platform === "twitter" && !isTwitterEnabled()) {
    throw new Error(
      'twitter collector is disabled by default (X login wall). Set ENABLE_TWITTER=true only if you are using official API/integration.',
    );
  }

  return collectorMap[platform];
}

export function listPlatforms(): Platform[] {
  return (Object.keys(collectorMap) as Platform[]).filter(
    (platform) => platform !== "twitter" || isTwitterEnabled(),
  );
}

export function listDisabledPlatforms(): Platform[] {
  const disabled: Platform[] = [];
  if (!isTwitterEnabled()) {
    disabled.push("twitter");
  }

  return disabled;
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
