import type { CollectedItem } from '@mia/shared-core';
export interface HNCollectorOptions {
    query: string;
    limit?: number;
    tags?: 'story' | 'ask_hn' | 'show_hn';
}
/**
 * Collect stories from HackerNews via the Algolia search API.
 * Free, no auth required.
 */
export declare function collectHackerNews(options: HNCollectorOptions): Promise<CollectedItem[]>;
//# sourceMappingURL=hackernews.d.ts.map