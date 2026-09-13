# @mia/core-collectors

[![npm](https://img.shields.io/npm/v/@mia/core-collectors)](https://www.npmjs.com/package/@mia/core-collectors)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://github.com/mira-js/mia-core/blob/main/LICENSE)

Reddit, HackerNews, and RSS/News collectors for the MIA pipeline. Each function returns `CollectedItem[]` from `@mia/shared-core`. All three work without credentials — bring API keys for higher rate limits or full-text extraction.

---

## Install

```bash
npm install @mia/core-collectors
# or
pnpm add @mia/core-collectors
```

---

## Collectors

### Reddit — `collectReddit`

Searches one or more subreddits for posts matching a query via the Apify actor [`fatihtahta/reddit-scraper-search-fast`](https://apify.com/fatihtahta/reddit-scraper-search-fast) — **pay-per-event**, billed per dataset record. Reddit's own unauthenticated JSON API returns 403, and the free OAuth tier excludes competitor monitoring, so there is no free fallback path.

```ts
import { collectReddit } from '@mia/core-collectors'

const items = await collectReddit({
  subreddits: ['SaaS', 'startups', 'smallbusiness'],
  query: 'CRM pain points',
  depth: 'quick',   // 'quick' (default) | 'deep' — decides the per-run caps
})
```

**Credentials (required):**

```bash
APIFY_API_TOKEN=      # required — collectReddit throws without it
```

All subreddits are covered by a **single** actor run — one Reddit *search URL* per
subreddit in the actor's `urls` input (URLs take priority over `queries`). The
actor input is fixed apart from the caps:

```jsonc
{
  "urls": ["https://www.reddit.com/r/SaaS/search/?q=…&restrict_sr=1&sort=relevance&t=year"],
  "sort": "relevance", "timeframe": "year",
  "scrapeComments": true, "maxComments": 3, "maxPosts": 8,
  "strictTokenFilter": true, "maximize_coverage": false,
  "includeNsfw": false, "sentiment_analysis": false, "content_analysis": false
}
```

**Cost is bounded, not caller-controlled.** `planRedditRun(depth, subredditCount)`
(`src/reddit-run-plan.ts`) computes `maxPosts`/`maxComments` so that
`seeds × maxPosts × (1 + maxComments)` — the billed-result count, since each post
*and* each comment is one billed record — stays at **≤ 100 for `quick`** and
**≤ 500 for `deep`**. The seed list is capped at `MAX_REDDIT_SEEDS` (5); extra
subreddits are dropped with a warning. Comments are never turned off: extraction
uses `raw_replies` as corroboration against clickbait titles, and `maxComments`
never exceeds 5 because downstream only sends `raw_replies.slice(0, 5)` to the LLM.

**Output shape — posts and comments are sibling records**, not nested:

```jsonc
{ "kind": "post",    "id": "1hvoazn", "title": "…", "body": "…", "author": "…",
  "score": 3489, "num_comments": 43, "subreddit": "Baking", "created_utc": "…", "url": "…" }
{ "kind": "comment", "id": "m5un6bj", "postId": "1hvoazn", "body": "…",
  "score": 76, "depth": 0, "…": "…" }
```

Only `kind: "post"` records become `CollectedItem`s. Comment records are grouped by
`postId` and become that post's `raw_replies` — top-level comments (`depth === 0`)
first, then by `score` descending, capped at 5 bodies. `id` and `postId` are required
non-empty, so a drift in either fails loudly instead of silently emptying replies.

Rate limiting and retries are handled by the Apify platform. An empty `subreddits`
list returns `[]` without dispatching a (paid) run.

See *Error behavior* below — this collector throws rather than returning partial results.

---

### HackerNews — `collectHackerNews`

Searches stories (and optionally Ask HN / Show HN posts) via the Algolia HN API. No credentials required.

Every request sends `removeWordsIfNoResults=lastWords`: Algolia keeps the strict
AND-query when it matches, and only drops trailing query terms when the full query
returns zero hits. Long multi-keyword queries therefore degrade to fewer terms
instead of returning nothing.

```ts
import { collectHackerNews } from '@mia/core-collectors'

const items = await collectHackerNews({
  query: 'project management tool',
  limit: 20,                    // default 20
  tags: 'story',                // 'story' | 'ask_hn' | 'show_hn', default 'story'
})
```

**Tags:**
| `tags` | What it searches |
|--------|-----------------|
| `story` | Link posts and text posts (default) |
| `ask_hn` | "Ask HN: …" posts only |
| `show_hn` | "Show HN: …" posts only |

---

### RSS / News — `collectNewsRSS`

Fetches and filters articles from RSS/Atom feeds. Keyword filtering uses a two-tier match (exact phrase → term overlap) so you only ingest relevant articles. Optionally fetches full article text via Jina Reader.

```ts
import { collectNewsRSS } from '@mia/core-collectors'

const items = await collectNewsRSS({
  feeds: [
    'https://techcrunch.com/feed/',
    'https://news.ycombinator.com/rss',
    'https://feeds.feedburner.com/venturebeat/SZYF',
  ],
  query: 'B2B SaaS pricing',    // optional keyword filter
})
```

**Full-text extraction (optional):**
Set `MIA_ENABLE_FULLTEXT=true` and optionally `JINA_API_KEY` to fetch full article bodies via [Jina Reader](https://jina.ai/reader). Without a key the reader is still accessible but at lower rate limits.

```bash
MIA_ENABLE_FULLTEXT=true
JINA_API_KEY=jina_...
```

Full-text is only fetched for exact-match articles to avoid unnecessary API calls.

---

## Return type

All three functions return `Promise<CollectedItem[]>`. See [@mia/shared-core](../shared-core) for the full type definition.

```ts
interface CollectedItem {
  source: string      // 'reddit' | 'hackernews' | 'news'
  url: string
  title: string
  body: string
  author: string
  timestamp: string   // ISO 8601
  engagement: { upvotes: number; comments: number }
  raw_replies: string[]
  subreddit?: string  // Reddit only
  category?: string   // RSS only — feed title
}
```

---

## Error behavior

Each function is designed to be failure-tolerant:

- `collectReddit` — **fails loudly**. One Apify actor call covers all subreddits; it throws when `APIFY_API_TOKEN` is unset, on a non-ok actor status, on a network/timeout error, on a non-array body, or when the actor returned a non-empty array from which no item survived schema validation (drift). A genuinely empty actor response returns `[]` — that is a real zero-result search, not a failure.
- `collectHackerNews` — throws on non-2xx response (let your caller handle it)
- `collectNewsRSS` — runs feeds in parallel with `Promise.allSettled`; failed feeds are silently skipped; full-text fetch has a 10 s timeout per article

---

## Writing your own collector

Implement the `Collector` interface from `@mia/shared-core` and your collector will work anywhere in the pipeline:

```ts
import type { Collector, CollectorOptions, CollectedItem } from '@mia/shared-core'

export class MyCollector implements Collector {
  async collect({ query, limit = 25 }: CollectorOptions): Promise<CollectedItem[]> {
    // fetch, parse, return CollectedItem[]
  }
}
```

The three built-in collectors are the best reference — each is under 130 lines.

---

## Part of mia-core

This package is part of the [mia-core](https://github.com/mira-js/mia-core) monorepo — a self-hostable market intelligence engine.
