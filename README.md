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

Searches one or more subreddits for posts matching a query. Falls back to the public JSON API when no OAuth credentials are configured.

```ts
import { collectReddit } from '@mia/core-collectors'

const items = await collectReddit({
  subreddits: ['SaaS', 'startups', 'smallbusiness'],
  query: 'CRM pain points',
  limit: 25,    // per subreddit, default 25
})
```

**Rate limits:**
- Unauthenticated (default): ~10 requests/min per subreddit
- Authenticated OAuth app: ~100 requests/min

**Credentials (optional):** Set these env vars to use the OAuth path:

```bash
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USERNAME=
REDDIT_PASSWORD=
REDDIT_USER_AGENT=myapp/0.1.0
```

If any of the four credential vars is missing, the collector silently uses the unauthenticated path.

---

### HackerNews — `collectHackerNews`

Searches stories (and optionally Ask HN / Show HN posts) via the Algolia HN API. No credentials required.

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

- `collectReddit` — runs subreddits in parallel with `Promise.allSettled`; failed subreddits are silently skipped
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
