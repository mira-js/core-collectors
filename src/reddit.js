"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectReddit = collectReddit;
const snoowrap_1 = __importDefault(require("snoowrap"));
const zod_1 = require("zod");
const shared_core_1 = require("@mia/shared-core");
// ─── Zod schemas ──────────────────────────────────────────────────────────────
const RedditPostSchema = zod_1.z.object({
    title: zod_1.z.string().default(''),
    selftext: zod_1.z.string().default(''),
    author: zod_1.z.union([zod_1.z.string(), zod_1.z.object({ name: zod_1.z.string() })]).transform((v) => typeof v === 'string' ? v : v.name),
    score: zod_1.z.number().default(0),
    num_comments: zod_1.z.number().default(0),
    created_utc: zod_1.z.number().transform((s) => new Date(s * 1000).toISOString()),
    permalink: zod_1.z.string().optional(),
    url: zod_1.z.string().optional(),
});
const RedditSearchResponseSchema = zod_1.z.object({
    data: zod_1.z.object({
        children: zod_1.z.array(zod_1.z.object({ data: RedditPostSchema })),
    }),
});
// ─── Helpers ──────────────────────────────────────────────────────────────────
function postUrl(post) {
    if (post.permalink) {
        const p = post.permalink;
        return `https://reddit.com${p.startsWith('/') ? p : `/${p}`}`;
    }
    return post.url ?? '';
}
function toCollectedItem(post, subreddit) {
    const url = postUrl(post);
    if (!url)
        return null;
    return {
        source: shared_core_1.Source.reddit,
        url,
        title: post.title,
        body: post.selftext,
        author: post.author || '[deleted]',
        timestamp: post.created_utc,
        engagement: { upvotes: post.score, comments: post.num_comments },
        raw_replies: [],
        subreddit,
    };
}
// ─── Unauthenticated path ─────────────────────────────────────────────────────
async function searchSubredditUnauthenticated(subreddit, query, limit) {
    const params = new URLSearchParams({ q: query, restrict_sr: 'true', sort: 'relevance', limit: String(limit) });
    const res = await fetch(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json?${params}`, { headers: { 'User-Agent': process.env.REDDIT_USER_AGENT || 'mia/0.1.0' } });
    if (!res.ok)
        throw new Error(`Reddit search failed: ${res.status}`);
    const parsed = RedditSearchResponseSchema.safeParse(await res.json());
    if (!parsed.success)
        return [];
    return parsed.data.data.children
        .map(({ data: post }) => toCollectedItem(post, subreddit))
        .filter((item) => item !== null);
}
// ─── Authenticated path ───────────────────────────────────────────────────────
const SnoowrapResultSchema = zod_1.z.array(RedditPostSchema);
async function searchSubredditAuthenticated(client, subreddit, query, limit) {
    const raw = await client.oauthRequest({
        uri: `r/${subreddit}/search`,
        method: 'get',
        qs: { q: query, restrict_sr: true, sort: 'relevance', limit },
    });
    const parsed = SnoowrapResultSchema.safeParse(raw);
    if (!parsed.success)
        return [];
    return parsed.data
        .map((post) => toCollectedItem(post, subreddit))
        .filter((item) => item !== null);
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Collect posts from Reddit.
 *
 * Authenticated path (100 req/min): set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET,
 *   REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_USER_AGENT.
 *
 * Unauthenticated fallback (10 req/min): omit the above — uses the public
 *   JSON API with a User-Agent header only.
 */
async function collectReddit(options) {
    const { subreddits, query, limit = 25 } = options;
    const hasCredentials = !!(process.env.REDDIT_CLIENT_ID &&
        process.env.REDDIT_CLIENT_SECRET &&
        process.env.REDDIT_USERNAME &&
        process.env.REDDIT_PASSWORD);
    if (!hasCredentials) {
        const settled = await Promise.allSettled(subreddits.map((s) => searchSubredditUnauthenticated(s, query, limit)));
        return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    }
    const client = new snoowrap_1.default({
        userAgent: process.env.REDDIT_USER_AGENT || 'mia/0.1.0',
        clientId: process.env.REDDIT_CLIENT_ID,
        clientSecret: process.env.REDDIT_CLIENT_SECRET,
        username: process.env.REDDIT_USERNAME,
        password: process.env.REDDIT_PASSWORD,
    });
    const settled = await Promise.allSettled(subreddits.map((s) => searchSubredditAuthenticated(client, s, query, limit)));
    return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
//# sourceMappingURL=reddit.js.map