import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { collectReddit } from '../src/reddit'

const fixturePath = fileURLToPath(new URL('./fixtures/apify-reddit-sample.synthetic.json', import.meta.url))
const fixtureRaw: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'))
const fixtureItems: unknown[] = Array.isArray(fixtureRaw)
  ? fixtureRaw
  : isRecord(fixtureRaw) && Array.isArray(fixtureRaw.items)
    ? fixtureRaw.items
    : []

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('collectReddit (Apify)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('APIFY_API_TOKEN', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('maps the fixture actor run to CollectedItem[]', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(fixtureItems))

    const items = await collectReddit({ subreddits: ['SaaS'], query: 'invoicing', limit: 25 })

    expect(items.length).toBeGreaterThan(0)
    expect(items).toMatchSnapshot()
    expect(items[0]).toMatchObject({
      source: 'reddit',
      subreddit: expect.any(String),
      engagement: { upvotes: expect.any(Number), comments: expect.any(Number) },
    })
    expect(Array.isArray(items[0].raw_replies)).toBe(true)
  })

  it('populates subreddit, engagement and raw_replies', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          url: 'https://www.reddit.com/r/SaaS/comments/abc/invoicing_is_broken/',
          title: 'Invoicing is broken',
          body: 'It crashes every time.',
          username: 'user1',
          upVotes: 42,
          numberOfComments: 7,
          createdAt: '2024-01-01T00:00:00.000Z',
          communityName: 'r/SaaS',
          parsedCommunityName: 'SaaS',
          comments: [{ body: 'Same issue here.' }, { body: 'Works for me.' }],
        },
      ]),
    )

    const items = await collectReddit({ subreddits: ['SaaS'], query: 'invoicing' })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: 'reddit',
      url: 'https://www.reddit.com/r/SaaS/comments/abc/invoicing_is_broken/',
      title: 'Invoicing is broken',
      body: 'It crashes every time.',
      author: 'user1',
      timestamp: '2024-01-01T00:00:00.000Z',
      engagement: { upvotes: 42, comments: 7 },
      subreddit: 'SaaS',
      raw_replies: ['Same issue here.', 'Works for me.'],
    })
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
        {
          url: 'https://www.reddit.com/r/startups/comments/def/x/',
          title: 'Valid',
          parsedCommunityName: 'startups',
        },
      ]),
    )

    const items = await collectReddit({ subreddits: ['SaaS', 'startups'], query: 'invoicing' })

    expect(items).toHaveLength(1)
    expect(items[0].subreddit).toBe('startups')
    expect(items[0].author).toBe('[deleted]')
  })

  it('sends one start URL per subreddit plus the computed maxPostCount/maxItems', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    await collectReddit({ subreddits: ['SaaS', 'startups'], query: 'invoicing', limit: 25 })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const input: unknown = JSON.parse(String(init.body))
    expect(input).toMatchObject({
      startUrls: [
        'https://www.reddit.com/r/SaaS/search/?q=invoicing&restrict_sr=1&sort=relevance',
        'https://www.reddit.com/r/startups/search/?q=invoicing&restrict_sr=1&sort=relevance',
      ],
      maxPostCount: 25,
      maxItems: 50,
      maxComments: 10,
      searchPosts: true,
      sort: 'Relevance',
    })
  })
})
