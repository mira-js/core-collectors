import { z } from 'zod'
import type { CollectedItem } from '@mia/shared-core'
import { Source } from '@mia/shared-core'

export interface HNCollectorOptions {
  query: string
  limit?: number
  tags?: 'story' | 'ask_hn' | 'show_hn'
}

const HN_ALGOLIA = 'https://hn.algolia.com/api/v1'
const HN_BASE = 'https://news.ycombinator.com/item?id='

const HNAlgoliaResponseSchema = z.object({
  hits: z.array(
    z.object({
      objectID: z.string(),
      title: z.string(),
      url: z.string().optional(),
      story_text: z.string().optional(),
      author: z.string(),
      created_at: z.string(),
      points: z.number().optional(),
      num_comments: z.number().optional(),
    }),
  ),
})

/**
 * Collect stories from HackerNews via the Algolia search API.
 * Free, no auth required.
 */
export async function collectHackerNews(options: HNCollectorOptions): Promise<CollectedItem[]> {
  const { query, limit = 20, tags = 'story' } = options

  const params = new URLSearchParams({ query, hitsPerPage: String(limit), tags })
  const res = await fetch(`${HN_ALGOLIA}/search?${params}`)
  if (!res.ok) throw new Error(`HN Algolia search failed: ${res.status}`)

  const { hits } = HNAlgoliaResponseSchema.parse(await res.json())

  return hits.map((hit) => ({
    source: Source.hackernews,
    url: hit.url || `${HN_BASE}${hit.objectID}`,
    title: hit.title,
    body: hit.story_text || '',
    author: hit.author,
    timestamp: hit.created_at,
    engagement: {
      upvotes: hit.points ?? 0,
      comments: hit.num_comments ?? 0,
    },
    raw_replies: [],
  }))
}
