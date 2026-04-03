import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'

const mockOauthRequest = vi.fn()

vi.mock('snoowrap', () => ({
  default: vi.fn().mockImplementation(() => ({ oauthRequest: mockOauthRequest })),
}))

import { collectReddit } from '../src/reddit'

const mockPost = {
  permalink: '/r/saas/comments/abc/invoicing_tool_is_broken/',
  title: 'Invoicing tool is broken',
  selftext: 'It crashes every time.',
  author: { name: 'user1' },
  created_utc: 1704067200,
  score: 42,
  num_comments: 7,
  comments: [
    { body: 'Same issue here.' },
    { body: 'Works for me.' },
  ],
}

describe('collectReddit', () => {
  const saved = {
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    REDDIT_USERNAME: process.env.REDDIT_USERNAME,
    REDDIT_PASSWORD: process.env.REDDIT_PASSWORD,
  }

  beforeAll(() => {
    process.env.REDDIT_CLIENT_ID = 'test-client-id'
    process.env.REDDIT_CLIENT_SECRET = 'test-secret'
    process.env.REDDIT_USERNAME = 'test-user'
    process.env.REDDIT_PASSWORD = 'test-pass'
  })

  afterAll(() => {
    for (const key of Object.keys(saved) as (keyof typeof saved)[]) {
      const v = saved[key]
      if (v === undefined) delete process.env[key]
      else process.env[key] = v
    }
  })

  beforeEach(() => {
    mockOauthRequest.mockReset()
  })

  it('maps posts to CollectedItem shape', async () => {
    mockOauthRequest.mockResolvedValue([mockPost])
    const items = await collectReddit({ subreddits: ['saas'], query: 'invoice', limit: 25 })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: 'reddit',
      url: 'https://reddit.com/r/saas/comments/abc/invoicing_tool_is_broken/',
      title: 'Invoicing tool is broken',
      body: 'It crashes every time.',
      author: 'user1',
      timestamp: '2024-01-01T00:00:00.000Z',
      engagement: { upvotes: 42, comments: 7 },
      subreddit: 'saas',
    })
  })

  it('collects from multiple subreddits', async () => {
    mockOauthRequest.mockResolvedValue([mockPost])
    const items = await collectReddit({ subreddits: ['saas', 'startups'], query: 'invoice' })
    expect(items).toHaveLength(2)
    expect(items[0].subreddit).toBe('saas')
    expect(items[1].subreddit).toBe('startups')
  })

  it('extracts raw_replies from post comments', async () => {
    mockOauthRequest.mockResolvedValue([mockPost])
    const items = await collectReddit({ subreddits: ['saas'], query: 'invoice' })
    expect(items[0].raw_replies).toEqual(['Same issue here.', 'Works for me.'])
  })

  it('handles post with no comments gracefully', async () => {
    mockOauthRequest.mockResolvedValue([{ ...mockPost, comments: undefined }])
    const items = await collectReddit({ subreddits: ['saas'], query: 'invoice' })
    expect(items[0].raw_replies).toEqual([])
  })

  it('handles deleted author', async () => {
    mockOauthRequest.mockResolvedValue([{ ...mockPost, author: null }])
    const items = await collectReddit({ subreddits: ['saas'], query: 'invoice' })
    expect(items[0].author).toBe('[deleted]')
  })

  it('returns empty array when search returns no posts', async () => {
    mockOauthRequest.mockResolvedValue([])
    const items = await collectReddit({ subreddits: ['saas'], query: 'xyzzy' })
    expect(items).toHaveLength(0)
  })

  it('does not throw when one subreddit fails — returns results from others', async () => {
    mockOauthRequest
      .mockRejectedValueOnce(new Error('Reddit API 403'))
      .mockResolvedValueOnce([mockPost])

    const items = await collectReddit({ subreddits: ['saas', 'startups'], query: 'invoice' })
    expect(items).toHaveLength(1)
    expect(items[0].subreddit).toBe('startups')
  })
})
