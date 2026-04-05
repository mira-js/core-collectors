import Parser from 'rss-parser'
import type { CollectedItem } from '@mira/shared-core'
import { CoreSource } from '@mira/shared-core'

export interface RSSCollectorOptions {
  feeds: string[]
  query?: string
}

type FeedItem = Parser.Item & { creator?: string; content?: string }
type MatchTier = 'exact' | 'loose' | 'none'

const parser = new Parser()

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by',
  'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the',
  'this', 'to', 'with',
])

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
}

function classifyMatch(text: string, qLower: string, terms: string[]): MatchTier {
  if (!terms.length) return 'exact'
  if (text.includes(qLower)) return 'exact'
  const matched = terms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0)
  const strictRequired = Math.min(terms.length, 2)
  const looseRequired = Math.min(terms.length, 1)
  if (matched >= strictRequired) return 'exact'
  if (matched >= looseRequired) return 'loose'
  return 'none'
}

async function fetchFullText(articleUrl: string): Promise<string> {
  const headers: Record<string, string> = { Accept: 'text/markdown', 'X-Return-Format': 'markdown' }
  if (process.env.JINA_API_KEY) headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`

  const request = fetch(`https://r.jina.ai/${articleUrl}`, { headers })
    .then((res) => (res.ok ? res.text() : ''))
    .catch(() => '')

  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(''), 10_000))
  return Promise.race([request, timeout])
}

async function toCollectedItem(
  item: FeedItem,
  feedTitle: string | undefined,
  enableFullText: boolean,
): Promise<CollectedItem> {
  const fullText = enableFullText && item.link ? await fetchFullText(item.link) : ''
  return {
    source: CoreSource.news,
    url: item.link || '',
    title: item.title || '',
    body: fullText || item.contentSnippet || item.content || '',
    author: item.creator || '',
    timestamp: item.isoDate || new Date().toISOString(),
    engagement: { upvotes: 0, comments: 0 },
    raw_replies: [],
    category: feedTitle,
  }
}

async function collectFeed(
  feedUrl: string,
  qLower: string,
  terms: string[],
  enableFullText: boolean,
): Promise<{ exact: CollectedItem[]; loose: CollectedItem[] }> {
  const feed = await parser.parseURL(feedUrl)
  const exact: CollectedItem[] = []
  const loose: CollectedItem[] = []

  await Promise.all(
    feed.items.map(async (item) => {
      const text = `${item.title ?? ''} ${item.contentSnippet ?? ''}`.toLowerCase()
      const tier = classifyMatch(text, qLower, terms)
      if (tier === 'none') return
      const collected = await toCollectedItem(item as FeedItem, feed.title, enableFullText && tier === 'exact')
      if (tier === 'exact') exact.push(collected)
      else loose.push(collected)
    }),
  )

  return { exact, loose }
}

/**
 * Collect articles from RSS/Atom feeds.
 * Optionally filter by keyword before ingesting.
 * Full-text extraction via Jina Reader (https://r.jina.ai/<url>).
 */
export async function collectNewsRSS(options: RSSCollectorOptions): Promise<CollectedItem[]> {
  const { feeds, query } = options
  const qLower = query?.trim().toLowerCase() ?? ''
  const terms = qLower ? tokenize(qLower) : []
  const enableFullText = process.env.MIA_ENABLE_FULLTEXT === 'true'

  const settled = await Promise.allSettled(
    feeds.map((feedUrl) => collectFeed(feedUrl, qLower, terms, enableFullText)),
  )

  const fulfilled = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const exact = fulfilled.flatMap((r) => r.exact)
  const loose = fulfilled.flatMap((r) => r.loose)

  return exact.length > 0 ? exact : loose
}