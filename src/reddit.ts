import Snoowrap from 'snoowrap'
import { z } from 'zod'
import type { CollectedItem } from '@mia/shared-core'
import { Source } from '@mia/shared-core'

export interface RedditCollectorOptions {
  subreddits: string[]
  query: string
  limit?: number
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const RedditPostSchema = z.object({
  title: z.string().default(''),
  selftext: z.string().default(''),
  author: z.union([z.string(), z.object({ name: z.string() })]).transform((v) =>
    typeof v === 'string' ? v : v.name,
  ),
  score: z.number().default(0),
  num_comments: z.number().default(0),
  created_utc: z.number().transform((s) => new Date(s * 1000).toISOString()),
  permalink: z.string().optional(),
  url: z.string().optional(),
})

const RedditSearchResponseSchema = z.object({
  data: z.object({
    children: z.array(z.object({ data: RedditPostSchema })),
  }),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function postUrl(post: z.infer<typeof RedditPostSchema>): string {
  if (post.permalink) {
    const p = post.permalink
    return `https://reddit.com${p.startsWith('/') ? p : `/${p}`}`
  }
  return post.url ?? ''
}

function toCollectedItem(post: z.infer<typeof RedditPostSchema>, subreddit: string): CollectedItem | null {
  const url = postUrl(post)
  if (!url) return null
  return {
    source: Source.reddit,
    url,
    title: post.title,
    body: post.selftext,
    author: post.author || '[deleted]',
    timestamp: post.created_utc,
    engagement: { upvotes: post.score, comments: post.num_comments },
    raw_replies: [],
    subreddit,
  }
}

// ─── Unauthenticated path ─────────────────────────────────────────────────────

async function searchSubredditUnauthenticated(
  subreddit: string,
  query: string,
  limit: number,
): Promise<CollectedItem[]> {
  const params = new URLSearchParams({ q: query, restrict_sr: 'true', sort: 'relevance', limit: String(limit) })
  const res = await fetch(
    `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json?${params}`,
    { headers: { 'User-Agent': process.env.REDDIT_USER_AGENT || 'mia/0.1.0' } },
  )
  if (!res.ok) throw new Error(`Reddit search failed: ${res.status}`)

  const parsed = RedditSearchResponseSchema.safeParse(await res.json())
  if (!parsed.success) return []

  return parsed.data.data.children
    .map(({ data: post }) => toCollectedItem(post, subreddit))
    .filter((item): item is CollectedItem => item !== null)
}

// ─── Authenticated path ───────────────────────────────────────────────────────

const SnoowrapResultSchema = z.array(RedditPostSchema)

async function searchSubredditAuthenticated(
  client: Snoowrap,
  subreddit: string,
  query: string,
  limit: number,
): Promise<CollectedItem[]> {
  const raw: unknown = await client.oauthRequest({
    uri: `r/${subreddit}/search`,
    method: 'get',
    qs: { q: query, restrict_sr: true, sort: 'relevance', limit },
  })

  const parsed = SnoowrapResultSchema.safeParse(raw)
  if (!parsed.success) return []

  return parsed.data
    .map((post) => toCollectedItem(post, subreddit))
    .filter((item): item is CollectedItem => item !== null)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Collect posts from Reddit.
 *
 * Authenticated path (100 req/min): set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET,
 *   REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_USER_AGENT.
 *
 * Unauthenticated fallback (10 req/min): omit the above — uses the public
 *   JSON API with a User-Agent header only.
 */
export async function collectReddit(options: RedditCollectorOptions): Promise<CollectedItem[]> {
  const { subreddits, query, limit = 25 } = options

  const hasCredentials = !!(
    process.env.REDDIT_CLIENT_ID &&
    process.env.REDDIT_CLIENT_SECRET &&
    process.env.REDDIT_USERNAME &&
    process.env.REDDIT_PASSWORD
  )

  if (!hasCredentials) {
    const settled = await Promise.allSettled(
      subreddits.map((s) => searchSubredditUnauthenticated(s, query, limit)),
    )
    return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  }

  const client = new Snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT || 'mia/0.1.0',
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
  })

  const settled = await Promise.allSettled(
    subreddits.map((s) => searchSubredditAuthenticated(client, s, query, limit)),
  )
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}
