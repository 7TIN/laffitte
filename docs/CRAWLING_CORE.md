# Crawling Core (Bun + Hono + Crawlee)

This is the first backend core for data collection.  
It supports static crawling with `CheerioCrawler` and JS-heavy crawling with `PuppeteerCrawler`.

Notes:
- `productName`, `keywords`, `aliases`, `hashtags`, and `socialHandles` are optional inputs.
- In search-term matching, `socialHandles` are treated as brand metadata, not as mandatory search constraints.
- `durationHours` is supported to keep results recent (for example: `1`, `10`, `24`).

## Supported Platforms

- `web` (custom start URLs, static pages)
- `news` (Google News search pages)
- `reddit` (old.reddit search + comments)
- `youtube` (search + video comments)
- `instagram` (hashtag/profile feeds + post comments)
- `amazon` (search + review pages)

`twitter` is intentionally disabled by default because unauthenticated crawling is login-gated on X.
Later, it can be re-enabled with paid API/integration (`ENABLE_TWITTER=true`).

## API Endpoints

- `GET /crawl/platforms`
- `POST /crawl/platform/:platform`
- `POST /crawl/run`

## Single Platform Request

```json
{
  "runId": "run-coke-001",
  "product": {
    "productName": "Coca-Cola",
    "aliases": ["Coke", "Coke Zero"],
    "socialHandles": ["@CocaCola"],
    "hashtags": ["#CocaCola", "#CokeZero"],
    "keywords": ["cola drink", "coke flavor"]
  },
  "options": {
    "maxItems": 120,
    "maxRequestsPerCrawl": 30,
    "includeReplies": true,
    "maxScrollSteps": 8,
    "durationHours": 24
  }
}
```

## Multi Platform Request

```json
{
  "runId": "run-coke-002",
  "product": {
    "productName": "Coca-Cola",
    "aliases": ["Coke", "Diet Coke"],
    "hashtags": ["#CocaCola"]
  },
  "platforms": ["reddit", "youtube", "news", "instagram"],
  "optionsByPlatform": {
    "reddit": {
      "maxItems": 80
    },
    "news": {
      "locale": "en-US",
      "maxItems": 60
    },
    "instagram": {
      "maxItems": 80,
      "maxScrollSteps": 8
    }
  }
}
```

## Output

Each collector returns:
- normalized `items`
- `warnings` for failed pages or blocked pages
- `totalCollected` count

The orchestrator aggregates this into one run-level response.
