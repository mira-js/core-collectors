export type { CollectedItem } from '@mira/shared-core'

export { collectReddit } from './reddit.js'
export type { RedditCollectorOptions } from './reddit.js'
export { planRedditRun, MAX_REDDIT_SEEDS } from './reddit-run-plan.js'
export type { RedditDepth, RedditRunPlan } from './reddit-run-plan.js'

export { collectHackerNews } from './hackernews.js'
export type { HNCollectorOptions } from './hackernews.js'

export { collectNewsRSS } from './news-rss.js'
export type { RSSCollectorOptions } from './news-rss.js'

export { requestApifyActor } from './apify.js'
export type { ApifyError, ApifyRunOptions } from './apify.js'
