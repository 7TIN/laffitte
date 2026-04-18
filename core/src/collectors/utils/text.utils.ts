import { createHash } from "node:crypto";

import type { Platform, ProductSeed } from "../../types/crawl.types.ts";

export function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

export function compactText(input: string, maxLength = 1800): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

export function buildSearchTerms(product: ProductSeed): string[] {
  const terms = new Set<string>();
  if (typeof product.productName === "string") {
    terms.add(product.productName);
  }

  for (const value of product.aliases ?? []) {
    terms.add(value);
  }

  for (const value of product.hashtags ?? []) {
    terms.add(value);
    terms.add(value.replace(/^#/, ""));
  }

  for (const value of product.keywords ?? []) {
    terms.add(value);
  }

  return [...terms]
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

export function matchesAnyProductTerm(text: string, product: ProductSeed): boolean {
  const source = normalizeText(text);
  if (source.length === 0) {
    return false;
  }

  const terms = buildSearchTerms(product);
  if (terms.length === 0) {
    return true;
  }

  return terms.some((term) => source.includes(normalizeText(term)));
}

function parseRelativeTimeToMs(value: string): number | undefined {
  const source = value.trim().toLowerCase();
  if (source.length === 0) {
    return undefined;
  }

  if (source === "now" || source === "just now") {
    return Date.now();
  }

  const match = source.match(
    /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/,
  );
  if (!match) {
    return undefined;
  }

  const amountRaw = match[1];
  const unitRaw = match[2];
  if (!amountRaw || !unitRaw) {
    return undefined;
  }

  const amount = Number.parseInt(amountRaw, 10);
  if (Number.isNaN(amount) || amount <= 0) {
    return undefined;
  }

  const multipliers = {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
  } as const;

  if (!(unitRaw in multipliers)) {
    return undefined;
  }

  const multiplier = multipliers[unitRaw as keyof typeof multipliers];
  if (!multiplier) {
    return undefined;
  }

  return Date.now() - amount * multiplier;
}

export function parseDateLike(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) {
    return direct;
  }

  return parseRelativeTimeToMs(value);
}

export function isWithinDuration(
  postedAt: string | null | undefined,
  durationHours: number | null | undefined,
): boolean {
  if (!durationHours || durationHours <= 0) {
    return true;
  }

  if (!postedAt) {
    return true;
  }

  const parsed = parseDateLike(postedAt);
  if (!parsed) {
    return true;
  }

  const threshold = Date.now() - durationHours * 3_600_000;
  return parsed >= threshold;
}

export function stableItemId(
  runId: string,
  platform: Platform,
  sourceUrl: string,
  text: string,
  index: number,
): string {
  const seed = `${runId}|${platform}|${sourceUrl}|${text.slice(0, 120)}|${index}`;
  return createHash("sha1").update(seed).digest("hex");
}

export function extractExternalId(sourceUrl: string, fallbackPrefix: string): string {
  try {
    const parsed = new URL(sourceUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1] ?? `${fallbackPrefix}-unknown`;
    }
  } catch {
    // Keep fallback behavior.
  }

  return `${fallbackPrefix}-unknown`;
}

export function parseCompactNumber(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const source = value.replace(/,/g, "").trim().toLowerCase();
  if (source.length === 0) {
    return undefined;
  }

  const suffix = source[source.length - 1];
  const numeric = Number.parseFloat(source);

  if (Number.isNaN(numeric)) {
    return undefined;
  }

  if (suffix === "k") {
    return Math.round(numeric * 1_000);
  }

  if (suffix === "m") {
    return Math.round(numeric * 1_000_000);
  }

  if (suffix === "b") {
    return Math.round(numeric * 1_000_000_000);
  }

  return Math.round(numeric);
}
