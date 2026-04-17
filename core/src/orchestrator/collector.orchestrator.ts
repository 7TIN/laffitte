import { getCollector } from "../collectors/index.ts";
import type {
  CollectorResult,
  CrawlRunResult,
  CrawlRunTask,
  CrawlTask,
  Platform,
} from "../types/crawl.types.ts";

export class CollectorOrchestrator {
  async run(task: CrawlRunTask): Promise<CrawlRunResult> {
    const startedAt = new Date().toISOString();
    const results = await Promise.all(
      task.platforms.map((platform) =>
        this.runSingle({
          runId: task.runId,
          platform,
          product: task.product,
          options: task.optionsByPlatform?.[platform],
        }),
      ),
    );
    const completedAt = new Date().toISOString();
    const totalItems = results.reduce((sum, result) => sum + result.totalCollected, 0);

    return {
      runId: task.runId,
      startedAt,
      completedAt,
      totalItems,
      results,
    };
  }

  async runSingle(task: CrawlTask): Promise<CollectorResult> {
    const collector = getCollector(task.platform);
    try {
      return await collector.collect(task);
    } catch (error) {
      return {
        runId: task.runId,
        platform: task.platform,
        totalCollected: 0,
        items: [],
        warnings: [this.formatError(task.platform, error)],
      };
    }
  }

  private formatError(platform: Platform, error: unknown): string {
    if (error instanceof Error) {
      return `${platform} collector crashed: ${error.message}`;
    }

    return `${platform} collector crashed with unknown error`;
  }
}

