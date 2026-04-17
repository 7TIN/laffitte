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
