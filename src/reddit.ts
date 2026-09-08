import { z } from 'zod'
import type { CollectedItem } from '@mira/shared-core'
import { CoreSource } from '@mira/shared-core'
import { requestApifyActor } from './apify.js'

export interface RedditCollectorOptions {
  subreddits: string[]
  query: string
  limit?: number
}

const REDDIT_ACTOR_ID = 'trudax/reddit-scraper'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function extractReplies(comments: unknown): string[] {
  if (!Array.isArray(comments)) return []
  return comments.slice(0, 10).flatMap((c) => {
    if (!isRecord(c)) return []
    const body = readString(c, 'body')
    return body ? [body] : []
  })
}

// ─── Zod schema ───────────────────────────────────────────────────────────────

const AuthorSchema = z
  .union([z.string(), z.object({ name: z.string() }), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return ''
    return typeof v === 'string' ? v : v.name
  })

const TimestampSchema = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return new Date(0).toISOString()
    // Actor emits ISO strings; numbers are treated as unix seconds.
    const date = typeof v === 'number' ? new Date(v * 1000) : new Date(v)
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
  })

/**
 * Dataset item shape for `trudax/reddit-scraper` post records.
 *
 * `url` is deliberately required and non-empty — it is the identity of the item
 * and the one field whose absence means the response shape has drifted.
 */
const ApifyRedditPostSchema = z.object({
  url: z.string().min(1),
  title: z.string().default(''),
  body: z.string().nullish().transform((v) => v ?? ''),
  username: AuthorSchema,
  upVotes: z.number().nullish().transform((v) => v ?? 0),
  numberOfComments: z.number().nullish().transform((v) => v ?? 0),
  createdAt: TimestampSchema,
  communityName: z.string().nullish().transform((v) => v ?? ''),
  parsedCommunityName: z.string().nullish().transform((v) => v ?? ''),
  dataType: z.string().nullish().transform((v) => v ?? ''),
  comments: z.unknown().optional(),
})

type ApifyRedditPost = z.infer<typeof ApifyRedditPostSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeSubreddit(post: ApifyRedditPost): string {
  const name = post.parsedCommunityName || post.communityName
  return name.replace(/^\/?r\//, '')
}

function toCollectedItem(post: ApifyRedditPost): CollectedItem {
  return {
    source: CoreSource.reddit,
    url: post.url,
    title: post.title,
    body: post.body,
    author: post.username || '[deleted]',
    timestamp: post.createdAt,
    engagement: { upvotes: post.upVotes, comments: post.numberOfComments },
    raw_replies: extractReplies(post.comments),
    subreddit: normalizeSubreddit(post),
  }
}

function searchUrl(subreddit: string, query: string): string {
  return `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search/?q=${encodeURIComponent(query)}&restrict_sr=1&sort=relevance`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Collect Reddit posts via the Apify actor `trudax/reddit-scraper`.
 *
 * Requires `APIFY_API_TOKEN` (paid rental actor).
 *
 * Fail-loud contract: this **throws** when the token is missing, the actor
 * returns a non-ok status, the request fails, the body is not an array, or the
 * actor returned a non-empty array from which no item survived parsing (schema
 * drift). A genuinely empty actor response returns `[]` — that is a real
 * zero-result search, not a failure.
 */
export async function collectReddit(options: RedditCollectorOptions): Promise<CollectedItem[]> {
  const { subreddits, query, limit = 25 } = options

  const result = await requestApifyActor(REDDIT_ACTOR_ID, {
    startUrls: subreddits.map((s) => searchUrl(s, query)),
    sort: 'Relevance',
    searchPosts: true,
    maxPostCount: limit,
    maxItems: limit * subreddits.length,
    maxComments: 10,
  })

  if (!result.ok) {
    throw new Error(`Reddit/Apify collection failed (${result.error.kind}): ${result.error.message}`)
  }

  const raw = result.value
  if (raw.length === 0) return []

  const items = raw.flatMap((entry) => {
    const parsed = ApifyRedditPostSchema.safeParse(entry)
    if (!parsed.success) return []
    return [toCollectedItem(parsed.data)]
  })

  if (items.length === 0) {
    throw new Error(
      `Reddit/Apify collection failed (bad-shape): actor returned ${raw.length} item(s) but none matched the expected post shape`,
    )
  }

  return items
}
