import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createUsageRecorder, runWithUsageRecorder, runInUsageSource } from '@mira/shared-core/usage-scope'
import { requestApifyActor } from '../src/apify'

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('requestApifyActor usage recording', () => {
  it('[unhappy] HTTP 500 inside runInUsageSource("reddit") records billed = null', async () => {
    vi.stubEnv('APIFY_API_TOKEN', 't')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500, statusText: 'Server Error' })))

    const recorder = createUsageRecorder()
    const result = await runWithUsageRecorder(recorder, () =>
      runInUsageSource('reddit', () => requestApifyActor('actor-1', {})),
    )

    expect(result.ok).toBe(false)
    expect(recorder.snapshot().sources.reddit.billedResults).toBeNull()
  })

  it('[unhappy] network error inside runInUsageSource("reddit") records billed = null', async () => {
    vi.stubEnv('APIFY_API_TOKEN', 't')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))

    const recorder = createUsageRecorder()
    const result = await runWithUsageRecorder(recorder, () =>
      runInUsageSource('reddit', () => requestApifyActor('actor-1', {})),
    )

    expect(result.ok).toBe(false)
    expect(recorder.snapshot().sources.reddit.billedResults).toBeNull()
  })

  it('[unhappy] non-array body inside runInUsageSource("reddit") records billed = null', async () => {
    vi.stubEnv('APIFY_API_TOKEN', 't')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ not: 'an array' }), { status: 200 })))

    const recorder = createUsageRecorder()
    const result = await runWithUsageRecorder(recorder, () =>
      runInUsageSource('reddit', () => requestApifyActor('actor-1', {})),
    )

    expect(result.ok).toBe(false)
    expect(recorder.snapshot().sources.reddit.billedResults).toBeNull()
  })

  it('[unhappy] a missing token records nothing at all', async () => {
    vi.stubEnv('APIFY_API_TOKEN', '')
    vi.stubGlobal('fetch', vi.fn())

    const recorder = createUsageRecorder()
    const result = await runWithUsageRecorder(recorder, () =>
      runInUsageSource('reddit', () => requestApifyActor('actor-1', {})),
    )

    expect(result.ok).toBe(false)
    expect(recorder.snapshot().sources.reddit).toEqual({ cache: null, billedResults: 0, apifyCalls: 0 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('[happy] ok with 7 rows under source "g2", called twice → g2 billed 14, apifyCalls 2', async () => {
    vi.stubEnv('APIFY_API_TOKEN', 't')
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: i }))
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(rows), { status: 200 })))

    const recorder = createUsageRecorder()
    const result = await runWithUsageRecorder(recorder, () =>
      runInUsageSource('g2', async () => {
        await requestApifyActor('actor-g2', {})
        return requestApifyActor('actor-g2', {})
      }),
    )

    expect(result.ok).toBe(true)
    const snapshot = recorder.snapshot()
    expect(snapshot.sources.g2.billedResults).toBe(14)
    expect(snapshot.sources.g2.apifyCalls).toBe(2)
  })
})
