# core

Core service for product data crawling with `Hono + Crawlee` on Bun runtime.

## Install

```bash
bun install
```

## Run

```bash
bun run dev
```

## Routes

- `GET /` -> service info
- `GET /crawl/platforms` -> supported crawler platforms
- `POST /crawl/platform/:platform` -> crawl one platform
- `POST /crawl/run` -> crawl multiple platforms in parallel

## Default Crawl Profile

- `POST /crawl/run` now defaults to `["web", "news"]` when `body.platforms` is omitted.
- `reddit` and `twitter` are disabled by default.
  - Enable Reddit explicitly with `ENABLE_REDDIT=true`.
  - Enable X/Twitter explicitly with `ENABLE_TWITTER=true`.

This keeps the default flow focused on crawl-friendly sources (search/news/article pages) when social platforms are blocked or API access is unavailable.
