# ProductIntel — Architecture & Project Plan

> AI-powered product intelligence agent. Users define a product and platforms; the system autonomously
> collects, analyzes, and reports on public feedback — entirely in the background.

---

## 1. Core Idea

Users paste in:
- A **product name** (e.g. "Coca-Cola", "Coke Zero")
- **Similar/alias names** (e.g. "Coke", "Diet Coke")
- **Social media handles** (e.g. @CocaCola)
- **Hashtags** (e.g. #CocaCola, #CokeZero)
- **Platforms** they want monitored (Twitter/X, Reddit, YouTube, Amazon, Instagram, News)
- **Analysis services** they want applied (sentiment, trend, topics, etc.)

The system then:
1. Runs data collection jobs in the background across selected platforms
2. Runs the selected AI analysis sub-services on collected data in parallel
3. Assembles a structured report
4. Delivers it to the user dashboard (and optionally via email/webhook)

Users never need to be present while this runs. They come back to a finished report.

---

## 2. Tech Stack

| Layer              | Technology                                      |
|--------------------|-------------------------------------------------|
| Monorepo           | Bun workspaces                                  |
| Language           | TypeScript everywhere                           |
| Frontend           | Next.js 16.1 (App Router, Turbopack)            |
| Backend API        | Hono.js on `@hono/node-server`                  |
| Type-safe API      | Hono RPC client `hc<AppType>` (no tRPC needed)  |
| Validation         | Zod + `@hono/zod-validator`                     |
| Job Queue          | BullMQ + Redis                                  |
| Scheduling         | node-cron                                       |
| Database           | PostgreSQL + Prisma ORM                         |
| Scraping           | Playwright (JS-heavy sites) + Axios (REST APIs) |
| AI Analysis        | Anthropic SDK — claude-sonnet-4-6               |
| PDF Export         | Puppeteer                                       |
| CSV Export         | papaparse                                       |
| Styling            | Tailwind CSS v4                                 |
| Package Manager    | Bun                                             |

---

## 3. Monorepo Structure (Bun Workspaces)

```
productintel/
├── package.json                 ← root workspace definition
├── bun.lockb
├── tsconfig.base.json           ← shared TS config
├── docs/
│   └── ARCHITECTURE.md          ← this file
│
├── packages/
│   └── types/                   ← shared TypeScript interfaces
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── report.ts
│           ├── job.ts
│           └── analysis.ts
│
├── core/                        ← Hono API + all backend services
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             ← Hono app entry + AppType export
│       ├── routes/
│       │   ├── reports.ts
│       │   ├── agent.ts
│       │   ├── download.ts
│       │   └── jobs.ts
│       ├── orchestrator/
│       │   ├── mainOrchestrator.ts      ← top-level job coordinator
│       │   ├── collectorOrchestrator.ts ← manages all scraper workers
│       │   └── analysisOrchestrator.ts  ← manages all AI analysis workers
│       ├── collectors/          ← data collection microservices
│       │   ├── base.collector.ts
│       │   ├── twitter.collector.ts
│       │   ├── reddit.collector.ts
│       │   ├── youtube.collector.ts
│       │   ├── instagram.collector.ts
│       │   ├── amazon.collector.ts
│       │   └── news.collector.ts
│       ├── analysis/            ← AI analysis microservices
│       │   ├── base.analysis.ts
│       │   ├── sentiment.analysis.ts
│       │   ├── trend.analysis.ts
│       │   ├── topic.analysis.ts
│       │   ├── suggestion.analysis.ts
│       │   ├── competitor.analysis.ts
│       │   ├── emotion.analysis.ts
│       │   ├── urgency.analysis.ts
│       │   └── summary.analysis.ts
│       ├── queues/
│       │   ├── redis.ts
│       │   ├── collector.queue.ts
│       │   └── analysis.queue.ts
│       ├── workers/
│       │   ├── collector.worker.ts
│       │   └── analysis.worker.ts
│       ├── report/
│       │   ├── reportBuilder.ts
│       │   └── pdfGenerator.ts
│       ├── scheduler/
│       │   └── scheduler.ts
│       └── db/
│           ├── prisma/
│           │   └── schema.prisma
│           └── client.ts
│
└── web/                         ← Next.js 16 dashboard
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── app/
        │   ├── dashboard/
        │   ├── reports/[id]/
        │   ├── config/
        │   └── layout.tsx
        ├── lib/
        │   └── api.ts           ← hc<AppType> client
        ├── components/
        │   ├── InsightCard.tsx
        │   ├── MetricCard.tsx
        │   ├── SentimentBar.tsx
        │   └── DownloadPanel.tsx
        └── proxy.ts             ← Next.js 16 (replaces middleware.ts)
```

---

## 4. Job Orchestration Architecture

### 4.1 Top-level Flow

```
User submits config
       │
       ▼
Main Orchestrator
  ├── creates a "Run" record in DB (status: pending)
  ├── dispatches CollectorOrchestrator job
  └── once collection done → dispatches AnalysisOrchestrator job
       │
       ▼
Report Builder → PDF + JSON + CSV
       │
       ▼
User dashboard updated (polling or WebSocket)
```

### 4.2 Collector Orchestrator

Spawns one BullMQ job per selected platform in parallel:

| Worker              | Platform         | Method                    |
|---------------------|------------------|---------------------------|
| TwitterCollector    | X / Twitter      | Twitter API v2            |
| RedditCollector     | Reddit           | Reddit API (snoowrap)     |
| YouTubeCollector    | YouTube          | YouTube Data API v3       |
| InstagramCollector  | Instagram        | Apify scraper / RapidAPI  |
| AmazonCollector     | Amazon           | Playwright scraper        |
| NewsCollector       | News / Blogs     | RSS feeds + NewsAPI       |

All workers write raw collected posts/comments/reviews into a shared `RawData` table in PostgreSQL,
tagged with `runId`, `platform`, and `collectedAt`.

Collection jobs run **in parallel** using BullMQ concurrency.
The CollectorOrchestrator waits for all platform jobs to complete before triggering analysis.

### 4.3 Analysis Orchestrator (Sub-orchestration)

Once raw data is collected, the AnalysisOrchestrator spawns parallel BullMQ jobs
for each analysis service the user selected:

| Analysis Service       | What it does                                              | Claude prompt style       |
|------------------------|-----------------------------------------------------------|---------------------------|
| SentimentAnalysis      | Positive / Negative / Neutral score per post + aggregate  | classification            |
| TrendAnalysis          | Spikes, rising topics, week-over-week changes             | time-series pattern       |
| TopicClustering        | Groups feedback into themes (taste, packaging, price...)  | clustering + labeling     |
| SuggestionExtraction   | Pulls out explicit customer suggestions / feature reqs    | extraction                |
| CompetitorMentions     | Detects competitor comparisons in posts                   | entity detection          |
| EmotionAnalysis        | Anger, joy, frustration, excitement beyond sentiment      | multi-label classification|
| UrgencyDetection       | Flags posts needing immediate brand response (crises)     | binary + severity score   |
| InfluencerDetection    | Identifies high-follower accounts driving narratives      | account scoring           |
| GeographicAnalysis     | Where (regions/countries) feedback is coming from        | entity + geo extraction   |
| LanguageBreakdown      | What languages feedback appears in                        | detection + grouping      |
| SummaryGeneration      | Final human-readable executive summary for the report     | summarization             |

Each analysis worker:
1. Pulls raw data for the `runId` from PostgreSQL
2. Batches it into chunks (e.g. 50 posts per Claude API call)
3. Calls Claude with a structured JSON output prompt
4. Writes results back to the `AnalysisResult` table
5. Marks its BullMQ job as complete

The AnalysisOrchestrator waits for all selected analysis jobs to complete, then triggers the Report Builder.

### 4.4 BullMQ Queue Design

```
Queues:
  collector-queue     → one job per platform per run
  analysis-queue      → one job per analysis service per run
  report-queue        → one job per run (final assembly)

Job data shape:
  { runId, productConfig, serviceType, options }

Concurrency:
  collector-queue:   concurrency = 6  (one per platform, run in parallel)
  analysis-queue:    concurrency = 10 (all analysis services in parallel)
  report-queue:      concurrency = 2
```

---

## 5. Microservice Design Principle

Each collector and analysis service is a **self-contained class** extending a base:

```typescript
// base.collector.ts
abstract class BaseCollector {
  abstract platform: Platform
  abstract collect(config: ProductConfig): Promise<RawPost[]>
}

// base.analysis.ts
abstract class BaseAnalysis {
  abstract serviceType: AnalysisType
  abstract analyze(posts: RawPost[], config: ProductConfig): Promise<AnalysisResult>
}
```

This means:
- A user selecting only `[twitter, reddit]` + `[sentiment, trend]` runs exactly 2 collectors + 2 analysers
- A user selecting all platforms + all services runs all 6 collectors + 11 analysers
- The orchestrator doesn't care — it just reads the user's config and dispatches accordingly
- New collectors and analysers can be added without touching orchestration logic

---

## 6. Shared TypeScript Interfaces (`packages/types`)

```typescript
// Platform enum
export type Platform =
  | 'twitter'
  | 'reddit'
  | 'youtube'
  | 'instagram'
  | 'amazon'
  | 'news'

// Analysis service enum
export type AnalysisType =
  | 'sentiment'
  | 'trend'
  | 'topic_clustering'
  | 'suggestion_extraction'
  | 'competitor_mentions'
  | 'emotion'
  | 'urgency'
  | 'influencer'
  | 'geographic'
  | 'language_breakdown'
  | 'summary'

// What the user configures
export interface ProductConfig {
  id: string
  productName: string
  aliases: string[]           // ["Coke", "Diet Coke"]
  socialHandles: string[]     // ["@CocaCola"]
  hashtags: string[]          // ["#CocaCola", "#CokeZero"]
  platforms: Platform[]
  analysisTypes: AnalysisType[]
  schedule?: 'daily' | 'weekly' | 'manual'
}

// One collected post/comment/review
export interface RawPost {
  id: string
  runId: string
  platform: Platform
  externalId: string
  text: string
  author: string
  authorFollowers?: number
  url: string
  postedAt: Date
  collectedAt: Date
  metadata: Record<string, unknown>
}

// Result from one analysis service
export interface AnalysisResult {
  runId: string
  serviceType: AnalysisType
  data: unknown              // typed per service
  completedAt: Date
}

// Sentiment result shape
export interface SentimentResult {
  overall: { positive: number; neutral: number; negative: number }
  byPlatform: Record<Platform, { positive: number; neutral: number; negative: number }>
  posts: Array<{ postId: string; score: 'positive' | 'neutral' | 'negative'; confidence: number }>
}

// Final assembled report
export interface WeeklyReport {
  id: string
  runId: string
  productConfigId: string
  productName: string
  periodStart: Date
  periodEnd: Date
  totalMentions: number
  platformBreakdown: Record<Platform, number>
  analyses: Partial<Record<AnalysisType, AnalysisResult>>
  insights: InsightCard[]
  generatedAt: Date
  status: 'pending' | 'collecting' | 'analyzing' | 'building' | 'complete' | 'failed'
}

// UI card unit
export interface InsightCard {
  id: string
  title: string
  summary: string
  category: 'alert' | 'trend' | 'positive' | 'neutral' | 'suggestion'
  sentiment?: { positive: number; neutral: number; negative: number }
  platforms: Platform[]
  mentionCount: number
  tags: string[]
  detectedAt: Date
}
```

---

## 7. Prisma Database Schema (Overview)

```prisma
model ProductConfig {
  id           String   @id @default(cuid())
  productName  String
  aliases      String[]
  socialHandles String[]
  hashtags     String[]
  platforms    String[]
  analysisTypes String[]
  schedule     String?
  createdAt    DateTime @default(now())
  runs         Run[]
}

model Run {
  id              String   @id @default(cuid())
  productConfigId String
  productConfig   ProductConfig @relation(fields: [productConfigId], references: [id])
  status          String   @default("pending")
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  rawPosts        RawPost[]
  analysisResults AnalysisResult[]
  report          Report?
}

model RawPost {
  id          String   @id @default(cuid())
  runId       String
  run         Run      @relation(fields: [runId], references: [id])
  platform    String
  externalId  String
  text        String
  author      String
  authorFollowers Int?
  url         String
  postedAt    DateTime
  collectedAt DateTime @default(now())
  metadata    Json
}

model AnalysisResult {
  id          String   @id @default(cuid())
  runId       String
  run         Run      @relation(fields: [runId], references: [id])
  serviceType String
  data        Json
  completedAt DateTime @default(now())
}

model Report {
  id          String   @id @default(cuid())
  runId       String   @unique
  run         Run      @relation(fields: [runId], references: [id])
  data        Json
  pdfPath     String?
  generatedAt DateTime @default(now())
}
```

---

## 8. Hono API Routes

```
POST   /agent/run           → create a new Run from ProductConfig
GET    /agent/status/:runId → poll current run status + progress
GET    /reports             → list all reports for user
GET    /reports/:id         → get full report data
GET    /download/pdf/:id    → stream PDF
GET    /download/json/:id   → stream JSON
GET    /download/csv/:id    → stream CSV
POST   /config              → save a ProductConfig
GET    /config/:id          → get a ProductConfig
```

---

## 9. User Flow (End to End)

```
1. User opens web app
2. User fills out "New Product" form:
   - Product name + aliases
   - Social handles + hashtags
   - Select platforms (checkboxes)
   - Select analysis services (checkboxes)
   - Set schedule (manual / daily / weekly)
3. User clicks "Run Analysis"
4. Frontend calls POST /agent/run → gets back runId
5. Frontend polls GET /agent/status/:runId every 5s
6. Dashboard shows live progress:
   - "Collecting from Twitter... (done)"
   - "Collecting from Reddit... (in progress)"
   - "Running sentiment analysis... (queued)"
7. When complete, report appears in dashboard
8. User can view insight cards, charts, full report
9. User can download PDF / JSON / CSV
```

---

## 10. Monorepo Setup (Bun Workspaces)

### Root `package.json`
```json
{
  "name": "productintel",
  "private": true,
  "workspaces": ["packages/*", "core", "web"],
  "scripts": {
    "dev": "bun run --filter '*' dev",
    "dev:core": "bun run --filter core dev",
    "dev:web": "bun run --filter web dev",
    "build": "bun run --filter '*' build",
    "typecheck": "bun run --filter '*' typecheck"
  }
}
```

### `core/package.json`
```json
{
  "name": "core",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "build": "bun build src/index.ts --outdir dist",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.x",
    "@hono/node-server": "^1.x",
    "@hono/zod-validator": "^0.x",
    "zod": "^3.x",
    "@anthropic-ai/sdk": "^0.x",
    "bullmq": "^5.x",
    "ioredis": "^5.x",
    "node-cron": "^3.x",
    "@prisma/client": "^5.x",
    "playwright": "^1.x",
    "axios": "^1.x",
    "puppeteer": "^22.x",
    "papaparse": "^5.x",
    "types": "workspace:*"
  }
}
```

### `web/package.json`
```json
{
  "name": "web",
  "scripts": {
    "dev": "next dev --turbo",
    "build": "next build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^16.1.x",
    "react": "^19.x",
    "react-dom": "^19.x",
    "hono": "^4.x",
    "@tanstack/react-query": "^5.x",
    "recharts": "^2.x",
    "types": "workspace:*"
  }
}
```

### `packages/types/package.json`
```json
{
  "name": "types",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

### Root `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

### Commands to bootstrap the monorepo:
```bash
mkdir productintel && cd productintel
bun init -y

mkdir -p packages/types/src core/src web docs

# Create all package.json files as above
# then:
bun install
```

---

## 11. Analysis Services — Full List

| Service               | Input          | Output                                    | Use case                            |
|-----------------------|----------------|-------------------------------------------|-------------------------------------|
| Sentiment             | Raw posts      | pos/neg/neutral per post + aggregate      | Brand health score                  |
| Trend detection       | Raw posts      | Rising/falling topics over time           | Spot emerging issues early          |
| Topic clustering      | Raw posts      | Named clusters (taste, price, design...)  | Understand what people discuss      |
| Suggestion extraction | Raw posts      | List of explicit customer requests        | Product roadmap input               |
| Competitor mentions   | Raw posts      | Competitor names + context + sentiment    | Competitive intelligence            |
| Emotion analysis      | Raw posts      | Anger, joy, frustration, excitement       | Deeper than sentiment alone         |
| Urgency detection     | Raw posts      | Crisis flags + severity score             | PR and community management         |
| Influencer detection  | Raw posts      | High-reach accounts + their stance        | Influencer outreach prioritization  |
| Geographic analysis   | Raw posts      | Country/region breakdown of feedback      | Market-specific insights            |
| Language breakdown    | Raw posts      | Language distribution                     | Global reach understanding          |
| Summary generation    | All results    | Executive summary paragraph               | C-suite report section              |

---

*Last updated: April 2026*
*Stack: Next.js 16.1 + Hono.js + BullMQ + Redis + PostgreSQL + Prisma + Anthropic Claude*