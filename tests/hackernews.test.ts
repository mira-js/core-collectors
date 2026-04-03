import { describe, it, expect, vi, beforeEach } from 'vitest'
import { collectHackerNews } from '../src/hackernews'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const mockHit: {
  objectID: string
  title: string
  url: string | undefined
  story_text: string
  author: string
  created_at: string
  points: number | undefined
  num_comments: number | undefined
} = {
  objectID: '12345',
  title: 'Ask HN: Best invoicing tools for freelancers?',
  url: 'https://example.com/invoicing',
  story_text: 'Looking for recommendations...',
  author: 'hnuser',
  created_at: '2024-06-01T10:00:00Z',
  points: 87,
  num_comments: 34,
}

function mockAlgoliaResponse(hits = [mockHit]) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ hits }), { status: 200 }),
  )
}

describe('collectHackerNews', () => {
  beforeEach(() => fetchMock.mockClear())

  it('calls HN Algolia with correct query params', async () => {
    mockAlgoliaResponse()
    await collectHackerNews({ query: 'invoice freelancer', limit: 10 })

    const [url] = fetchMock.mock.calls[0]
    const urlStr = String(url)
    expect(urlStr).toContain('hn.algolia.com')
    expect(urlStr).toContain('query=invoice+freelancer')
    expect(urlStr).toContain('hitsPerPage=10')
    expect(urlStr).toContain('tags=story')
  })

  it('maps hits to CollectedItem shape', async () => {
    mockAlgoliaResponse()
    const items = await collectHackerNews({ query: 'invoice' })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: 'hackernews',
      url: 'https://example.com/invoicing',
      title: 'Ask HN: Best invoicing tools for freelancers?',
      body: 'Looking for recommendations...',
      author: 'hnuser',
      timestamp: '2024-06-01T10:00:00Z',
      engagement: { upvotes: 87, comments: 34 },
      raw_replies: [],
    })
  })

  it('falls back to HN item URL when url field is absent', async () => {
    mockAlgoliaResponse([{ ...mockHit, url: undefined }])
    const items = await collectHackerNews({ query: 'invoice' })
    expect(items[0].url).toBe('https://news.ycombinator.com/item?id=12345')
  })

  it('defaults missing points and num_comments to 0', async () => {
    mockAlgoliaResponse([{ ...mockHit, points: undefined, num_comments: undefined }])
    const items = await collectHackerNews({ query: 'invoice' })
    expect(items[0].engagement).toEqual({ upvotes: 0, comments: 0 })
  })

  it('returns empty array when no hits', async () => {
    mockAlgoliaResponse([])
    const items = await collectHackerNews({ query: 'xyzzy' })
    expect(items).toHaveLength(0)
  })

  it('uses "ask_hn" tag when specified', async () => {
    mockAlgoliaResponse()
    await collectHackerNews({ query: 'invoice', tags: 'ask_hn' })
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('tags=ask_hn')
  })

  it('throws on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
    await expect(collectHackerNews({ query: 'invoice' })).rejects.toThrow()
  })
})
