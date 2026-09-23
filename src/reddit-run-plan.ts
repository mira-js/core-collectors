/**
 * Cost planning for the Reddit Apify actor (`fatihtahta/reddit-scraper-search-fast`).
 *
 * The actor bills **pay-per-event**: every post *and* every comment in the
 * dataset is one billed result. The per-run ceiling is therefore
 *
 *   billed = seedLimit × maxPosts × (1 + maxComments)
 *
 * This module is the only place that number is decided, so the bound can be
 * proved by a pure unit test instead of by reading the collector.
 */

export type RedditDepth = 'quick' | 'deep'

export interface RedditRunPlan {
  /** Posts requested per input seed (the actor's `maxPosts`). */
  maxPosts: number
  /** Comments requested per post (the actor's `maxComments`). */
  maxComments: number
  /** Always `true` — replies are the corroboration signal for extraction. */
  scrapeComments: boolean
  /** How many subreddits actually become actor input URLs. */
  seedLimit: number
}

/**
 * Hard cap on how many subreddits one run may search.
 *
 * Mirrored by the seed cap in
 * `packages/api/src/services/query-understanding-schema.ts`.
 */
export const MAX_REDDIT_SEEDS = 5

/**
 * Ceiling on `maxComments`. Extraction only ever sends `raw_replies.slice(0, 5)`
 * to the LLM (`packages/api/src/services/pipeline/extraction.ts`,
 * `mira-core/packages/core-services/src/analysis.ts`), so anything above 5 is
 * billed and then discarded.
 */
const MAX_COMMENTS_PER_POST = 5

/** Billed-result budget per run, by depth. */
const BUDGET: Record<RedditDepth, number> = { quick: 100, deep: 500 }

/** Comments requested per post, by depth (never above {@link MAX_COMMENTS_PER_POST}). */
const COMMENTS_PER_POST: Record<RedditDepth, number> = { quick: 3, deep: 5 }

/**
 * Decide the actor's per-run caps for `depth` and a subreddit count.
 *
 * `budget` lets a caller that shares one run cap across several billed sources
 * pass Reddit's slice. It can only lower the ceiling: the effective budget is
 * `min(budget, BUDGET[depth])`, so no caller can raise Reddit's spend above the
 * depth cap. Omitting it reproduces the depth cap exactly.
 *
 * Lever order (fixed): cap the seed list, then reduce `maxPosts` (floor 1),
 * never drop comments.
 */
export function planRedditRun(depth: RedditDepth, subredditCount: number, budget?: number): RedditRunPlan {
  const effectiveBudget = Math.min(budget ?? BUDGET[depth], BUDGET[depth])
  const maxComments = Math.min(COMMENTS_PER_POST[depth], MAX_COMMENTS_PER_POST)
  const seedLimit = Math.max(0, Math.min(Math.floor(subredditCount), MAX_REDDIT_SEEDS))

  // A zero-seed run is never dispatched, but the plan must still be well formed.
  const divisor = Math.max(1, seedLimit) * (1 + maxComments)
  const maxPosts = Math.max(1, Math.floor(effectiveBudget / divisor))

  return { maxPosts, maxComments, scrapeComments: true, seedLimit }
}
