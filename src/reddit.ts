import { z } from 'zod'
import type { CollectedItem } from '@mira/shared-core'
import { CoreSource } from '@mira/shared-core'
import { requestApifyActor } from './apify.js'
import { planRedditRun, type RedditDepth } from './reddit-run-plan.js'

export interface RedditCollectorOptions {
  subreddits: string[]
  query: string
  depth?: RedditDepth
  /**
   * Optional billed-result budget for this run (a caller's share of a run cap
   * split across several sources). Can only lower the depth cap — see
   * `planRedditRun`. Omit it to use the full depth cap.
   */
  budget?: number
}

const REDDIT_ACTOR_ID = 'fatihtahta/reddit-scraper-search-fast'

/** Replies actually consumed downstream — extraction slices to 5. */
const MAX_REPLIES_PER_POST = 5

// ─── Zod schemas ──────────────────────────────────────────────────────────────

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
 * Dataset item shape for `fatihtahta/reddit-scraper-search-fast` **post** records.
 *
 * `url` and `id` are deliberately required and non-empty: `url` is the identity
 * of the item, and `id` is what comment records join against. If `id` drifts,
 * reply attachment would silently produce empty `raw_replies` — requiring it
 * turns that into a loud `bad-shape` failure instead.
 */
const ApifyRedditPostSchema = z.object({
  kind: z.literal('post'),
  id: z.string().min(1),
  url: z.string().min(1),
  title: z.string().default(''),
  body: z.string().nullish().transform((v) => v ?? ''),
  author: AuthorSchema,
  score: z.number().nullish().transform((v) => v ?? 0),
  num_comments: z.number().nullish().transform((v) => v ?? 0),
  created_utc: TimestampSchema,
  subreddit: z.string().nullish().transform((v) => v ?? ''),
})

/**
 * Dataset item shape for **comment** records. The actor emits these as siblings
 * of the posts (not nested), joined by `postId`.
 */
const ApifyRedditCommentSchema = z.object({
  kind: z.literal('comment'),
  postId: z.string().min(1),
  body: z.string(),
  score: z.number().nullish().transform((v) => v ?? 0),
  depth: z.number().nullish().transform((v) => v ?? 0),
})

type ApifyRedditPost = z.infer<typeof ApifyRedditPostSchema>
type ApifyRedditComment = z.infer<typeof ApifyRedditCommentSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeSubreddit(post: ApifyRedditPost): string {
  return post.subreddit.replace(/^\/?r\//, '')
}

/**
 * Group comment records by their parent post id, keeping at most
 * {@link MAX_REPLIES_PER_POST} bodies per post: top-level comments
 * (`depth === 0`) first, then by `score` descending, dataset order breaking ties.
 */
function groupReplies(comments: ApifyRedditComment[]): Map<string, string[]> {
  const byPost = new Map<string, ApifyRedditComment[]>()
  for (const comment of comments) {
    const bucket = byPost.get(comment.postId)
    if (bucket) bucket.push(comment)
    else byPost.set(comment.postId, [comment])
  }

  const replies = new Map<string, string[]>()
  for (const [postId, bucket] of byPost) {
    const ordered = [...bucket].sort((a, b) => {
      const aTop = a.depth === 0 ? 0 : 1
      const bTop = b.depth === 0 ? 0 : 1
      if (aTop !== bTop) return aTop - bTop
      return b.score - a.score
    })
    replies.set(postId, ordered.slice(0, MAX_REPLIES_PER_POST).map((c) => c.body))
  }
  return replies
}

function toCollectedItem(post: ApifyRedditPost, replies: string[]): CollectedItem {
  return {
    source: CoreSource.reddit,
    url: post.url,
    title: post.title,
    body: post.body,
    author: post.author || '[deleted]',
    timestamp: post.created_utc,
    engagement: { upvotes: post.score, comments: post.num_comments },
    raw_replies: replies,
    subreddit: normalizeSubreddit(post),
  }
}

function searchUrl(subreddit: string, query: string): string {
  return `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search/?q=${encodeURIComponent(query)}&restrict_sr=1&sort=relevance&t=year`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Collect Reddit posts via the Apify actor `fatihtahta/reddit-scraper-search-fast`.
 *
 * Requires `APIFY_API_TOKEN`. The actor is **pay-per-event** (no monthly
 * rental): each post *and* each comment in the dataset is one billed result.
 * The per-run ceiling is decided by `planRedditRun` — ≤ 100 billed results for
 * `depth: 'quick'`, ≤ 500 for `depth: 'deep'` — and the seed list is capped at
 * `MAX_REDDIT_SEEDS` subreddits, so cost cannot grow with the caller's input.
 *
 * Fail-loud contract: this **throws** when the token is missing, the actor
 * returns a non-ok status, the request fails, the body is not an array, or the
 * actor returned a non-empty array from which no post survived parsing (schema
 * drift). A genuinely empty actor response returns `[]` — that is a real
 * zero-result search, not a failure. An empty `subreddits` list returns `[]`
 * without dispatching (and paying for) a run.
 */
export async function collectReddit(options: RedditCollectorOptions): Promise<CollectedItem[]> {
  const { subreddits, query, depth = 'quick', budget } = options

  const plan = planRedditRun(depth, subreddits.length, budget)
  if (plan.seedLimit === 0) return []

  const seeds = subreddits.slice(0, plan.seedLimit)
  if (seeds.length < subreddits.length) {
    console.warn(
      '[reddit] subreddit list capped',
      { kept: seeds, dropped: subreddits.slice(plan.seedLimit) },
    )
  }

  const result = await requestApifyActor(REDDIT_ACTOR_ID, {
    urls: seeds.map((s) => searchUrl(s, query)),
    sort: 'relevance',
    timeframe: 'year',
    scrapeComments: plan.scrapeComments,
    maxComments: plan.maxComments,
    maxPosts: plan.maxPosts,
    strictTokenFilter: true,
    maximize_coverage: false,
    includeNsfw: false,
    sentiment_analysis: false,
    content_analysis: false,
  })

  if (!result.ok) {
    throw new Error(`Reddit/Apify collection failed (${result.error.kind}): ${result.error.message}`)
  }

  const raw = result.value
  if (raw.length === 0) return []

  const posts = raw.flatMap((entry) => {
    const parsed = ApifyRedditPostSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })

  const comments = raw.flatMap((entry) => {
    const parsed = ApifyRedditCommentSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })

  if (posts.length === 0) {
    throw new Error(
      `Reddit/Apify collection failed (bad-shape): actor returned ${raw.length} item(s) but none matched the expected post shape`,
    )
  }

  const replies = groupReplies(comments)
  return posts.map((post) => toCollectedItem(post, replies.get(post.id) ?? []))
}
