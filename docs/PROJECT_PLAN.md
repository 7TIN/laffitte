# Product Intelligence Agent - Architecture and Execution Plan

## Vision
Build a TypeScript-first product intelligence platform where users provide product context (name, aliases, hashtags, official social handles, competitor terms) and choose which analysis services they want. The system then orchestrates data collection and AI analysis in background jobs, and delivers a report/dashboard.

## Your Core Idea (Validated)
Your architecture direction is correct and strong:
- Multi-source data collection running as background jobs.
- AI analysis split into independent sub-services (sentiment, trends, topics, feedback mining, etc.).
- Queue-based orchestration for reliability and scalability.
- Redis-backed job system for async processing.
- Modular microservices so each user gets only the services they request.
- Report generation as the final aggregation layer.

This is the right pattern for production-scale feedback intelligence.

## High-Level Architecture
1. Input + Configuration Service
- Accepts product details from user:
  - Product name and aliases
  - Brand handles
  - Hashtags/keywords
  - Target platforms
  - Time range (daily/weekly/custom)
  - Requested analysis modules
- Produces a `CampaignConfig` payload used by orchestration.

2. Orchestrator Service
- Reads `CampaignConfig` and builds an execution graph.
- Starts source collectors in parallel.
- Triggers analysis modules after ingestion completion checkpoints.
- Supports partial pipelines (example: only Twitter + sentiment).
- Tracks pipeline state: pending, running, failed, completed.

3. Data Collector Microservices
- One collector per source family:
  - Web/news/blog collector
  - Reddit/forums collector
  - X/Twitter collector
  - YouTube comments collector
  - Review-site collector
- Responsibilities:
  - Pull data via API/crawler
  - Normalize to common schema
  - Deduplicate
  - Attach metadata and source URL
  - Store raw + normalized payloads

4. Queue and Worker Layer
- Redis + queue workers for all heavy tasks.
- Job categories:
  - Ingestion jobs
  - Cleaning/enrichment jobs
  - AI analysis jobs
  - Report generation jobs
  - Delivery jobs (email/webhook/dashboard push)
- Benefits:
  - Retry and backoff
  - Concurrency control
  - Rate-limit protection per platform
  - Better fault isolation

5. AI Analysis Microservices (Composable)
Run these as independent modules so user can choose any subset:
- Sentiment analysis
- Emotion analysis
- Aspect-based sentiment (taste, packaging, price, delivery, quality)
- Topic clustering
- Trend detection (rising/falling topics)
- Spike/anomaly detection
- Complaint extraction
- Suggestion/feature request extraction
- Intent classification (question, complaint, praise, recommendation)
- Competitor mention analysis
- Geographic sentiment slicing (if data available)
- Influencer impact scoring
- Fake/spam signal detection
- Urgency/risk flagging
- Conversation summarization with citations
- Weekly narrative generation

6. Storage Layer
- PostgreSQL: normalized entities and report outputs
- Object storage: raw JSON snapshots
- Redis: queue, cache, transient states
- Optional vector index: semantic retrieval for clustering and QA

7. Report Generator
- Aggregates all analysis outputs into report sections:
  - Executive summary
  - Sentiment overview
  - Trend charts
  - Top complaints
  - Top suggestions
  - Risk alerts
  - Source breakdown
- Export options:
  - Web dashboard cards
  - PDF download
  - CSV/JSON export

8. Web App
- Minimal user interface:
  - Form to define product + services
  - Job status tracker
  - Report viewer
  - Download actions
- Most processing remains asynchronous in background workers.

## Recommended Orchestration Model
Use a parent-child pipeline model:
- Parent job: `campaign.run`
- Child stages:
  - `collect.*`
  - `normalize.clean`
  - `analyze.*`
  - `report.generate`
  - `report.deliver`

Execution rules:
- Run all selected `collect.*` jobs in parallel.
- Run `normalize.clean` when all selected collectors complete.
- Run selected `analyze.*` jobs in parallel.
- Run `report.generate` after all selected analysis jobs complete.
- Run delivery jobs after report success.

Failure strategy:
- Retry transient failures.
- Mark partial success if one source fails but others succeed.
- Include data quality notes in report.

## Microservice Boundaries (TypeScript)
Suggested initial services:
- `svc-orchestrator`
- `svc-collector-web`
- `svc-collector-reddit`
- `svc-collector-social`
- `svc-collector-youtube`
- `svc-analysis-sentiment`
- `svc-analysis-trends`
- `svc-analysis-feedback`
- `svc-reporting`
- `svc-api-gateway`
- `web-dashboard`

## Bun Workspaces Monorepo Direction
Planned workspace shape (after your setup):
- `core/`
  - shared types
  - queue contracts
  - config and utilities
  - service packages
- `web/`
  - dashboard app

Everything in TypeScript is a strong choice and fits this architecture well.

## Suggested Shared Types
Core contracts you should define early:
- `CampaignConfig`
- `SourceTarget`
- `CollectionRecord`
- `NormalizedFeedback`
- `AnalysisResult`
- `ReportModel`
- `PipelineState`
- `JobEnvelope`

## Implementation Phases
Phase 1 (MVP)
- Product config intake
- Two connectors (example: Reddit + YouTube)
- Sentiment + topic + suggestion extraction
- Basic report + PDF export

Phase 2
- Add trend/anomaly detection
- Add more sources
- Add alerting and scheduled recurring runs

Phase 3
- Advanced analytics and forecasting
- Better observability, billing, and multi-tenant controls

## Non-Functional Priorities
- Platform ToS compliance and rate limits
- Auditability with source citations
- Idempotent jobs
- Backpressure handling
- Observability (job traces and failure dashboards)
- Cost controls per run

## Current Decisions Logged
- Monorepo with Bun workspaces
- TypeScript for all services
- Background-job-first architecture
- Redis-backed queue design
- User-configurable modular analysis pipeline

---
This document captures the current architecture context and will act as the baseline plan for implementation.
