import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { collectReddit } from '../src/reddit'
import { planRedditRun } from '../src/reddit-run-plan'

// Real dataset from one `fatihtahta/reddit-scraper-search-fast` run
// (r/SaaS, "invoicing", maxPosts 5 / maxComments 3): posts and comments as
// sibling top-level records.
const fixturePath = fileURLToPath(new URL('./fixtures/apify-reddit-run.json', import.meta.url))
const fixtureItems: unknown[] = JSON.parse(readFileSync(fixturePath, 'utf8'))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function post(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'post',
    id: 'p1',
    url: 'https://www.reddit.com/r/SaaS/comments/p1/invoicing_is_broken/',
    title: 'Invoicing is broken',
    body: 'It crashes every time.',
    author: 'user1',
    score: 42,
    num_comments: 7,
    subreddit: 'SaaS',
    created_utc: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function comment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'comment',
    id: 'c1',
    postId: 'p1',
    body: 'Same issue here.',
    author: 'user2',
    score: 5,
    depth: 0,
    subreddit: 'SaaS',
    created_utc: '2024-01-01T01:00:00.000Z',
    url: 'https://www.reddit.com/r/SaaS/comments/p1/x/c1/',
    ...overrides,
  }
}

describe('collectReddit (Apify)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('APIFY_API_TOKEN', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('maps the real fixture actor run to CollectedItem[]', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(fixtureItems))

    const items = await collectReddit({ subreddits: ['SaaS'], query: 'invoicing' })

    expect(items.length).toBeGreaterThan(0)
    expect(items).toMatchSnapshot()
    expect(items[0]).toMatchObject({
      source: 'reddit',
      subreddit: expect.any(String),
      engagement: { upvotes: expect.any(Number), comments: expect.any(Number) },
    })
    expect(Array.isArray(items[0].raw_replies)).toBe(true)
    // Comment records are never items of their own.
    const postRecords = fixtureItems.filter(
      (entry) => (entry as { kind?: string }).kind === 'post',
    )
    expect(items).toHaveLength(postRecords.length)
  })

  it('attaches sibling comment records as raw_replies, top-level first and score-descending', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        post({ id: 'p1' }),
        post({
          id: 'p2',
          url: 'https://www.reddit.com/r/SaaS/comments/p2/no_replies/',
          title: 'No replies',
        }),
        comment({ id: 'c1', postId: 'p1', body: 'nested-high', score: 99, depth: 2 }),
        comment({ id: 'c2', postId: 'p1', body: 'top-low', score: 1, depth: 0 }),
        comment({ id: 'c3', postId: 'p1', body: 'top-high', score: 50, depth: 0 }),
      ]),
    )

    const items = await collectReddit({ subreddits: ['SaaS'], query: 'invoicing' })

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      source: 'reddit',
      url: 'https://www.reddit.com/r/SaaS/comments/p1/invoicing_is_broken/',
      title: 'Invoicing is broken',
      body: 'It crashes every time.',
      author: 'user1',
      timestamp: '2024-01-01T00:00:00.000Z',
      engagement: { upvotes: 42, comments: 7 },
      subreddit: 'SaaS',
      raw_replies: ['top-high', 'top-low', 'nested-high'],
    })
    expect(items[1].raw_replies).toEqual([])
  })

  it('caps raw_replies at 5 bodies per post', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        post({ id: 'p1' }),
        ...Array.from({ length: 8 }, (_, i) =>
          comment({ id: `c${i}`, postId: 'p1', body: `reply-${i}`, score: 100 - i, depth: 0 }),
        ),
      ]),
    )

    const items = await collectReddit({ subreddits: ['SaaS'], query: 'invoicing' })

    expect(items[0].raw_replies).toEqual([
      'reply-0',
      'reply-1',
      'reply-2',
      'reply-3',
      'reply-4',
    ])
  })

  it('drops a comment with a missing or empty postId instead of attaching it elsewhere', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        post({ id: 'p1' }),
        comment({ id: 'c1', postId: '', body: 'orphan-empty' }),
        { kind: 'comment', id: 'c2', body: 'orphan-missing', score: 3, depth: 0 },
      ]),
    )

    const items = await collectReddit({ subreddits: ['SaaS'], query: 'invoicing' })

    expect(items).toHaveLength(1)
    expect(items[0].raw_replies).toEqual([])
  })

  it('throws bad-shape when a post record has a missing or empty id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([post({ id: '' })]))

    await expect(collectReddit({ subreddits: ['SaaS'], query: 'invoicing' })).rejects.toThrow(
      /bad-shape/,
    )
  })

  it('throws bad-shape when the dataset holds only comment records', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([comment(), comment({ id: 'c2' })]))

    await expect(collectReddit({ subreddits: ['SaaS'], query: 'invoicing' })).rejects.toThrow(
      /bad-shape/,
    )
  })

  it('throws when APIFY_API_TOKEN is unset — and makes no request', async () => {
    vi.unstubAllEnvs()
    delete process.env.APIFY_API_TOKEN

    await expect(collectReddit({ subreddits: ['SaaS'], query: 'invoicing' })).rejects.toThrow(
      /missing-token/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws on a non-ok actor status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }))

    await expect(collectReddit({ subreddits: ['SaaS'], query: 'invoicing' })).rejects.toThrow(
      /http-status/,
    )
  })

  it('throws when fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network failure'))

    await expect(collectReddit({ subreddits: ['SaaS'], query: 'invoicing' })).rejects.toThrow(
      /network/,
    )
  })

  it('throws when the body is not an array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ not: 'an array' }))

    await expect(collectReddit({ subreddits: ['SaaS'], query: 'invoicing' })).rejects.toThrow(
      /bad-shape/,
    )
  })

  it('returns [] (does not throw) when the actor returns an empty array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    await expect(collectReddit({ subreddits: ['SaaS'], query: 'xyzzy' })).resolves.toEqual([])
  })

  it('throws when a non-empty array yields zero parsed items (schema drift)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ unexpected: 'shape' }, { also: 'wrong' }]))

    await expect(collectReddit({ subreddits: ['SaaS'], query: 'invoicing' })).rejects.toThrow(
      /bad-shape/,
    )
  })

  it('drops individually malformed items but returns the valid ones', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { unexpected: 'shape' },
        post({
          id: 'p9',
          url: 'https://www.reddit.com/r/startups/comments/p9/x/',
          title: 'Valid',
          subreddit: 'r/startups',
          author: undefined,
        }),
      ]),
    )

    const items = await collectReddit({ subreddits: ['SaaS', 'startups'], query: 'invoicing' })

    expect(items).toHaveLength(1)
    expect(items[0].subreddit).toBe('startups')
    expect(items[0].author).toBe('[deleted]')
  })

  it('returns [] without calling the actor when subreddits is empty', async () => {
    await expect(collectReddit({ subreddits: [], query: 'invoicing' })).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the fatihtahta input shape with the quick-depth caps', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    await collectReddit({ subreddits: ['SaaS', 'startups'], query: 'invoicing', depth: 'quick' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const input: unknown = JSON.parse(String(init.body))
    const plan = planRedditRun('quick', 2)

    expect(input).toEqual({
      urls: [
        'https://www.reddit.com/r/SaaS/search/?q=invoicing&restrict_sr=1&sort=relevance&t=year',
        'https://www.reddit.com/r/startups/search/?q=invoicing&restrict_sr=1&sort=relevance&t=year',
      ],
      sort: 'relevance',
      timeframe: 'year',
      scrapeComments: true,
      maxComments: plan.maxComments,
      maxPosts: plan.maxPosts,
      strictTokenFilter: true,
      maximize_coverage: false,
      includeNsfw: false,
      sentiment_analysis: false,
      content_analysis: false,
    })
    // Ground truth: the captured fixture records carry the search URL the real
    // actor run was given. Our generated URL must be character-identical to it.
    const capturedQueryUrl = (fixtureItems[0] as { query: string }).query
    expect(capturedQueryUrl).toBe(
      'https://www.reddit.com/r/SaaS/search/?q=invoicing&restrict_sr=1&sort=relevance&t=year',
    )

    expect(plan.maxComments).toBe(3)
    expect(plan.seedLimit * plan.maxPosts * (1 + plan.maxComments)).toBeLessThanOrEqual(100)
  })

  it('sends the deep-depth caps and defaults to quick when depth is omitted', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await collectReddit({ subreddits: ['SaaS', 'startups', 'smallbusiness'], query: 'invoicing', depth: 'deep' })

    const [, deepInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const deepInput = JSON.parse(String(deepInit.body)) as Record<string, unknown>
    expect(deepInput).toMatchObject({ maxPosts: 27, maxComments: 5, scrapeComments: true })
    expect(3 * 27 * 6).toBeLessThanOrEqual(500)

    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await collectReddit({ subreddits: ['SaaS', 'startups', 'smallbusiness'], query: 'invoicing' })

    const [, defaultInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const defaultInput = JSON.parse(String(defaultInit.body)) as Record<string, unknown>
    expect(defaultInput).toMatchObject({ maxPosts: 8, maxComments: 3 })
  })

  it('caps the actor input at 5 search URLs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    await collectReddit({
      subreddits: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'],
      query: 'invoicing',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const input = JSON.parse(String(init.body)) as { urls: string[] }
    expect(input.urls).toHaveLength(planRedditRun('quick', 7).seedLimit)
    expect(input.urls).toHaveLength(5)
    expect(input.urls[0]).toContain('/r/a1/')
    expect(input.urls[4]).toContain('/r/e5/')
  })
})
