import type { CollectedItem } from '@mia/shared-core';
export interface RSSCollectorOptions {
    feeds: string[];
    query?: string;
}
/**
 * Collect articles from RSS/Atom feeds.
 * Optionally filter by keyword before ingesting.
 * Full-text extraction via Jina Reader (https://r.jina.ai/<url>).
 */
export declare function collectNewsRSS(options: RSSCollectorOptions): Promise<CollectedItem[]>;
//# sourceMappingURL=news-rss.d.ts.map