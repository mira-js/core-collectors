import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)

import { collectReddit } from '../src/reddit'

const NOW = new Date('2026-10-07T12:00:00Z')
const HOUR_MS = 60 * 60 * 1000

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
    created_utc: '2026-10-07T11:00:00.000Z',
    ...overrides,
  }
}

function hoursBeforeNow(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR_MS).toISOString()
}

function readActorInput(): unknown {
  const init = fetchMock.mock.lastCall?.[1]
  if (typeof init?.body !== 'string') throw new Error('no body')
  const input: unknown = JSON.parse(init.body)
  return input
}

const baseOptions = { subreddits: ['SaaS', 'startups'], query: 'invoicing' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('APIFY_API_TOKEN', 'test-token')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  fetchMock.mockImplementation(async () => jsonResponse([post()]))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('collectReddit since window', () => {
  it('[unhappy] rejects an unparsable since before any actor run is dispatched', async () => {
    await expect(collectReddit({ ...baseOptions, since: 'not-a-date' })).rejects.toThrow(/invalid since/)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('[unhappy] drops posts created before since and keeps the later one', async () => {
    const since = hoursBeforeNow(2)
    fetchMock.mockImplementation(async () =>
      jsonResponse([
        post({
          id: 'old',
          title: 'Old post',
          url: 'https://www.reddit.com/r/SaaS/comments/old/old_post/',
          created_utc: hoursBeforeNow(5),
        }),
        post({
          id: 'new',
          title: 'New post',
          url: 'https://www.reddit.com/r/SaaS/comments/new/new_post/',
          created_utc: hoursBeforeNow(1),
        }),
      ]),
    )

    const items = await collectReddit({ ...baseOptions, since })

    expect(items.map((item) => item.title)).toEqual(['New post'])
  })

  it('[unhappy] returns [] without a bad-shape throw when every post is older than since', async () => {
    const since = hoursBeforeNow(2)
    fetchMock.mockImplementation(async () =>
      jsonResponse([
        post({ id: 'o1', created_utc: hoursBeforeNow(5) }),
        post({ id: 'o2', created_utc: hoursBeforeNow(9) }),
      ]),
    )

    await expect(collectReddit({ ...baseOptions, since })).resolves.toEqual([])
  })

  it('[happy] since 25h before now sends dateFrom, sort new, forced new sort and week timeframe with matching URLs', async () => {
    const since = hoursBeforeNow(25)

    await collectReddit({ ...baseOptions, since })

    expect(readActorInput()).toMatchObject({
      dateFrom: since,
      sort: 'new',
      forceSortNewForTimeFilteredRuns: true,
      timeframe: 'week',
      urls: [expect.stringContaining('sort=new&t=week'), expect.stringContaining('sort=new&t=week')],
    })
  })

  it('[happy] picks the narrowest timeframe: since 2h before now is day, 40 days before is year', async () => {
    await collectReddit({ ...baseOptions, since: hoursBeforeNow(2) })
    expect(readActorInput()).toMatchObject({
      timeframe: 'day',
      urls: [expect.stringContaining('sort=new&t=day'), expect.stringContaining('sort=new&t=day')],
    })

    await collectReddit({ ...baseOptions, since: hoursBeforeNow(40 * 24) })
    expect(readActorInput()).toMatchObject({
      timeframe: 'year',
      urls: [expect.stringContaining('sort=new&t=year'), expect.stringContaining('sort=new&t=year')],
    })
  })

  it('[happy] without since the actor input keeps relevance sort, year timeframe and no window keys (expect: green)', async () => {
    await collectReddit(baseOptions)

    const input = readActorInput()
    expect(input).toMatchObject({
      sort: 'relevance',
      timeframe: 'year',
      urls: [
        'https://www.reddit.com/r/SaaS/search/?q=invoicing&restrict_sr=1&sort=relevance&t=year',
        'https://www.reddit.com/r/startups/search/?q=invoicing&restrict_sr=1&sort=relevance&t=year',
      ],
    })
    expect(input).not.toHaveProperty('dateFrom')
    expect(input).not.toHaveProperty('forceSortNewForTimeFilteredRuns')
  })
})
