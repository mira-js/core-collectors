import type { CollectedItem } from '@mia/shared-core';
export interface RedditCollectorOptions {
    subreddits: string[];
    query: string;
    limit?: number;
}
/**
 * Collect posts from Reddit.
 *
 * Authenticated path (100 req/min): set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET,
 *   REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_USER_AGENT.
 *
 * Unauthenticated fallback (10 req/min): omit the above — uses the public
 *   JSON API with a User-Agent header only.
 */
export declare function collectReddit(options: RedditCollectorOptions): Promise<CollectedItem[]>;
//# sourceMappingURL=reddit.d.ts.map