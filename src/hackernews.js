"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectHackerNews = collectHackerNews;
const zod_1 = require("zod");
const shared_core_1 = require("@mia/shared-core");
const HN_ALGOLIA = 'https://hn.algolia.com/api/v1';
const HN_BASE = 'https://news.ycombinator.com/item?id=';
const HNAlgoliaResponseSchema = zod_1.z.object({
    hits: zod_1.z.array(zod_1.z.object({
        objectID: zod_1.z.string(),
        title: zod_1.z.string(),
        url: zod_1.z.string().optional(),
        story_text: zod_1.z.string().optional(),
        author: zod_1.z.string(),
        created_at: zod_1.z.string(),
        points: zod_1.z.number().optional(),
        num_comments: zod_1.z.number().optional(),
    })),
});
/**
 * Collect stories from HackerNews via the Algolia search API.
 * Free, no auth required.
 */
async function collectHackerNews(options) {
    const { query, limit = 20, tags = 'story' } = options;
    const params = new URLSearchParams({ query, hitsPerPage: String(limit), tags });
    const res = await fetch(`${HN_ALGOLIA}/search?${params}`);
    if (!res.ok)
        throw new Error(`HN Algolia search failed: ${res.status}`);
    const { hits } = HNAlgoliaResponseSchema.parse(await res.json());
    return hits.map((hit) => ({
        source: shared_core_1.Source.hackernews,
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
    }));
}
//# sourceMappingURL=hackernews.js.map