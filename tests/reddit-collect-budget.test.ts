import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/apify.js', () => ({
  requestApifyActor: vi.fn(),
}))

import { collectReddit } from '../src/reddit.js'
import { requestApifyActor } from '../src/apify.js'
import { planRedditRun } from '../src/reddit-run-plan.js'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requestApifyActor).mockResolvedValue({ ok: true, value: [] })
})

describe('collectReddit budget forwarding', () => {
  it('forwards budget to planRedditRun (reflected in the actor input caps)', async () => {
    await collectReddit({ subreddits: ['saas'], query: 'crm', depth: 'deep', budget: 100 })
    const plan = planRedditRun('deep', 1, 100)
    const [, input] = vi.mocked(requestApifyActor).mock.calls[0]
    expect(input).toMatchObject({ maxPosts: plan.maxPosts, maxComments: plan.maxComments })
  })

  it('a call without budget is unchanged (uses the full depth cap)', async () => {
    await collectReddit({ subreddits: ['saas'], query: 'crm', depth: 'deep' })
    const plan = planRedditRun('deep', 1)
    const [, input] = vi.mocked(requestApifyActor).mock.calls[0]
    expect(input).toMatchObject({ maxPosts: plan.maxPosts, maxComments: plan.maxComments })
  })
})
