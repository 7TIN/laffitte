import type { Page } from "puppeteer";

export async function autoScroll(page: Page, steps = 5, delayMs = 650): Promise<void> {
  for (let index = 0; index < steps; index += 1) {
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });
    await page.waitForTimeout(delayMs);
  }
}

