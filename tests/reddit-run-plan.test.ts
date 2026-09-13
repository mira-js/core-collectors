import { describe, it, expect } from 'vitest'
import { planRedditRun, MAX_REDDIT_SEEDS, type RedditDepth } from '../src/reddit-run-plan'

const BUDGET: Record<RedditDepth, number> = { quick: 100, deep: 500 }
const SUBREDDIT_COUNTS = [0, 1, 3, 5, 10, 50, 200]

describe('planRedditRun', () => {
  for (const depth of ['quick', 'deep'] as const) {
    describe(depth, () => {
      for (const count of SUBREDDIT_COUNTS) {
        it(`stays within the billed-result budget at ${count} subreddit(s)`, () => {
          const plan = planRedditRun(depth, count)

          // Billing is per dataset record: every post AND every comment counts.
          // The bound is over seedLimit, not the caller's list length.
          const billed = plan.seedLimit * plan.maxPosts * (1 + plan.maxComments)

          expect(billed).toBeLessThanOrEqual(BUDGET[depth])
          expect(plan.seedLimit).toBeLessThanOrEqual(MAX_REDDIT_SEEDS)
          expect(plan.seedLimit).toBeLessThanOrEqual(count)
          expect(plan.maxPosts).toBeGreaterThanOrEqual(1)
          expect(plan.maxComments).toBeLessThanOrEqual(5)
          expect(plan.scrapeComments).toBe(true)
        })
      }
    })
  }

  it('caps the seed list at MAX_REDDIT_SEEDS', () => {
    expect(MAX_REDDIT_SEEDS).toBe(5)
    expect(planRedditRun('quick', 200).seedLimit).toBe(5)
    expect(planRedditRun('deep', 200).seedLimit).toBe(5)
  })

  it('returns a zero seed limit for an empty subreddit list', () => {
    expect(planRedditRun('quick', 0).seedLimit).toBe(0)
    expect(planRedditRun('deep', 0).seedLimit).toBe(0)
  })

  it('produces the agreed per-depth caps at three subreddits', () => {
    expect(planRedditRun('quick', 3)).toEqual({
      maxPosts: 8,
      maxComments: 3,
      scrapeComments: true,
      seedLimit: 3,
    })
    expect(planRedditRun('deep', 3)).toEqual({
      maxPosts: 27,
      maxComments: 5,
      scrapeComments: true,
      seedLimit: 3,
    })
  })

  it('never turns comments off', () => {
    for (const count of SUBREDDIT_COUNTS) {
      expect(planRedditRun('quick', count).scrapeComments).toBe(true)
      expect(planRedditRun('deep', count).scrapeComments).toBe(true)
    }
  })
})
