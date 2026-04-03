import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { collectNewsRSS } from '../src/news-rss'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const mockFeedItem = {
  title: 'Invoice automation is broken for freelancers',
  link: 'https://techblog.com/invoice-automation',
  contentSnippet: 'Many freelancers struggle with recurring invoice bugs.',
  content: '<p>Many freelancers struggle with recurring invoice bugs.</p>',
  creator: 'Jane Doe',
  isoDate: '2024-06-15T08:00:00Z',
}

vi.mock('rss-parser', () => ({
  default: class {
    async parseURL(_url: string) {
      return { title: 'Tech Blog', items: [mockFeedItem] }
    }
  },
}))

describe('collectNewsRSS', () => {
  const savedEnableFullText = process.env.MIA_ENABLE_FULLTEXT

  beforeEach(() => {
    fetchMock.mockReset()
    delete process.env.MIA_ENABLE_FULLTEXT
  })

  afterAll(() => {
    if (savedEnableFullText === undefined) {
      delete process.env.MIA_ENABLE_FULLTEXT
    } else {
      process.env.MIA_ENABLE_FULLTEXT = savedEnableFullText
    }
  })

  it('maps feed items to CollectedItem shape', async () => {
    const items = await collectNewsRSS({ feeds: ['https://techblog.com/feed'] })

    expect(items).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(items[0]).toMatchObject({
      source: 'news',
      url: 'https://techblog.com/invoice-automation',
      title: 'Invoice automation is broken for freelancers',
      body: 'Many freelancers struggle with recurring invoice bugs.',
      author: 'Jane Doe',
      timestamp: '2024-06-15T08:00:00Z',
      engagement: { upvotes: 0, comments: 0 },
      raw_replies: [],
    })
  })

  it('uses full-text from Jina Reader when MIA_ENABLE_FULLTEXT=true', async () => {
    process.env.MIA_ENABLE_FULLTEXT = 'true'
    fetchMock.mockResolvedValueOnce(new Response('FULL TEXT BODY', { status: 200 }))

    const items = await collectNewsRSS({ feeds: ['https://techblog.com/feed'] })

    expect(items).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(items[0]?.body).toBe('FULL TEXT BODY')
  })

  it('sets category to the feed title', async () => {
    const items = await collectNewsRSS({ feeds: ['https://techblog.com/feed'] })
    expect(items[0].category).toBe('Tech Blog')
  })

  it('includes items matching query keyword', async () => {
    const items = await collectNewsRSS({
      feeds: ['https://techblog.com/feed'],
      query: 'invoice',
    })
    expect(items).toHaveLength(1)
  })

  it('excludes items not matching query keyword', async () => {
    const items = await collectNewsRSS({
      feeds: ['https://techblog.com/feed'],
      query: 'kubernetes',
    })
    expect(items).toHaveLength(0)
  })

  it('keyword match is case-insensitive', async () => {
    const items = await collectNewsRSS({
      feeds: ['https://techblog.com/feed'],
      query: 'INVOICE',
    })
    expect(items).toHaveLength(1)
  })

  it('matches multi-word queries by keyword overlap', async () => {
    const items = await collectNewsRSS({
      feeds: ['https://techblog.com/feed'],
      query: 'invoice automation pain points',
    })
    expect(items).toHaveLength(1)
  })

  it('processes multiple feeds and merges results', async () => {
    const items = await collectNewsRSS({
      feeds: ['https://techblog.com/feed', 'https://other.com/feed'],
    })
    expect(items).toHaveLength(2)
  })

  it('does not throw when one feed fails — returns results from others', async () => {
    const Parser = (await import('rss-parser')).default as unknown as {
      prototype: { parseURL: ReturnType<typeof vi.fn> }
    }
    const original = Parser.prototype.parseURL
    let callCount = 0
    Parser.prototype.parseURL = vi.fn().mockImplementation(async (url: string) => {
      callCount++
      if (callCount === 1) throw new Error('Network error')
      return { title: 'Other Feed', items: [mockFeedItem] }
    })

    const items = await collectNewsRSS({
      feeds: ['https://broken.com/feed', 'https://techblog.com/feed'],
    })

    expect(items).toHaveLength(1)
    Parser.prototype.parseURL = original
  })
})
