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
  terms.add(product.productName);

  for (const value of product.aliases ?? []) {
    terms.add(value);
  }

  for (const value of product.socialHandles ?? []) {
    terms.add(value);
    terms.add(value.replace(/^@/, ""));
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
    return false;
  }

  return terms.some((term) => source.includes(normalizeText(term)));
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

