import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/apify.js', () => ({ requestApifyActor: vi.fn() }))

import { requestApifyActor } from '../src/apify.js'
import { probeSubreddit } from '../src/reddit-probe.js'

const mockRequest = vi.mocked(requestApifyActor)

function postRow(subreddit: string | null | undefined, id = 'abc123'): Record<string, unknown> {
  return {
    kind: 'post',
    id,
    url: `https://www.reddit.com/r/x/comments/${id}/slug/`,
    title: 'A post',
    body: 'Body text',
    author: 'someone',
    score: 3,
    num_comments: 1,
    created_utc: '2026-01-01T00:00:00Z',
    subreddit,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('probeSubreddit', () => {
  it('[unhappy] passes an Apify http-status error through as ok:false with the same error', async () => {
    const error = { kind: 'http-status' as const, actorId: 'fatihtahta/reddit-scraper-search-fast', status: 500, message: 'boom' }
    mockRequest.mockResolvedValue({ ok: false, error })

    const result = await probeSubreddit('Dressmaker')

    expect(result).toEqual({ ok: false, error })
  })

  it('[unhappy] a non-empty dataset where no row parses as a post is ok:false with kind bad-shape', async () => {
    mockRequest.mockResolvedValue({ ok: true, value: [{ kind: 'comment', postId: 'x' }, { foo: 'bar' }] })

    const result = await probeSubreddit('Dressmaker')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('bad-shape')
    expect(result.error.actorId).toBe('fatihtahta/reddit-scraper-search-fast')
  })

  it('[unhappy] posts only from another subreddit are ok:true with value false', async () => {
    mockRequest.mockResolvedValue({ ok: true, value: [postRow('Other')] })

    const result = await probeSubreddit('Dressmaker')

    expect(result).toEqual({ ok: true, value: false })
  })

  it('[happy] an empty dataset is ok:true false, and the actor gets the one-post probe input with a 60s timeout', async () => {
    mockRequest.mockResolvedValue({ ok: true, value: [] })

    const result = await probeSubreddit('Dressmaker')

    expect(result).toEqual({ ok: true, value: false })
    expect(mockRequest).toHaveBeenCalledTimes(1)
    const [actorId, input, options] = mockRequest.mock.calls[0]
    expect(actorId).toBe('fatihtahta/reddit-scraper-search-fast')
    expect(input).toMatchObject({
      urls: ['https://www.reddit.com/r/Dressmaker/'],
      maxPosts: 1,
      scrapeComments: false,
    })
    expect(options).toEqual({ timeoutSecs: 60 })
  })

  it('[happy] a post with subreddit "r/dressmaker" for name Dressmaker is ok:true with value true (case-insensitive, r/ stripped)', async () => {
    mockRequest.mockResolvedValue({ ok: true, value: [postRow('r/dressmaker')] })

    const result = await probeSubreddit('Dressmaker')

    expect(result).toEqual({ ok: true, value: true })
  })
})
