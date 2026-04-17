# Crawling Core (Bun + Hono + Crawlee)

This is the first backend core for data collection.  
It supports static crawling with `CheerioCrawler` and JS-heavy crawling with `PuppeteerCrawler`.

## Supported Platforms

- `web` (custom start URLs, static pages)
- `news` (Google News search pages)
- `reddit` (old.reddit search + comments)
- `twitter` (X search + tweet detail pages)
- `youtube` (search + video comments)
- `instagram` (hashtag/profile feeds + post comments)
- `amazon` (search + review pages)

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
    "maxScrollSteps": 8
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
  "platforms": ["twitter", "reddit", "youtube", "news"],
  "optionsByPlatform": {
    "twitter": {
      "maxItems": 150,
      "includeReplies": true,
      "maxScrollSteps": 10
    },
    "reddit": {
      "maxItems": 80
    },
    "news": {
      "locale": "en-US",
      "maxItems": 60
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
