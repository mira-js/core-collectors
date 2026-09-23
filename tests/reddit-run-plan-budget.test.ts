import { describe, expect, it } from 'vitest'
import { planRedditRun } from '../src/reddit-run-plan.js'

describe('planRedditRun budget parameter', () => {
  it('honours an explicit budget below the depth cap', () => {
    const unbounded = planRedditRun('deep', 5, 500)
    const bounded = planRedditRun('deep', 5, 100)
    expect(bounded.maxPosts).toBeLessThanOrEqual(unbounded.maxPosts)
    // billed rows stay within the smaller budget
    const billed = bounded.seedLimit * bounded.maxPosts * (1 + bounded.maxComments)
    expect(billed).toBeLessThanOrEqual(100)
  })

  it('clamps a budget above the depth cap to the cap (matches the no-budget plan)', () => {
    const noBudget = planRedditRun('quick', 5)
    const aboveCap = planRedditRun('quick', 5, 10_000)
    expect(aboveCap).toEqual(noBudget)
  })

  it('omitting budget reproduces the existing (no-budget) plan exactly', () => {
    expect(planRedditRun('deep', 3, undefined)).toEqual(planRedditRun('deep', 3))
  })
})
