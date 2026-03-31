"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectNewsRSS = collectNewsRSS;
const rss_parser_1 = __importDefault(require("rss-parser"));
const shared_core_1 = require("@mia/shared-core");
const parser = new rss_parser_1.default();
const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by',
    'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the',
    'this', 'to', 'with',
]);
function tokenize(raw) {
    return raw
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.replace(/[^a-z0-9]/g, ''))
        .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}
function classifyMatch(text, qLower, terms) {
    if (!terms.length)
        return 'exact';
    if (text.includes(qLower))
        return 'exact';
    const matched = terms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0);
    const strictRequired = Math.min(terms.length, 2);
    const looseRequired = Math.min(terms.length, 1);
    if (matched >= strictRequired)
        return 'exact';
    if (matched >= looseRequired)
        return 'loose';
    return 'none';
}
async function fetchFullText(articleUrl) {
    const headers = { Accept: 'text/markdown', 'X-Return-Format': 'markdown' };
    if (process.env.JINA_API_KEY)
        headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`;
    const request = fetch(`https://r.jina.ai/${articleUrl}`, { headers })
        .then((res) => (res.ok ? res.text() : ''))
        .catch(() => '');
    const timeout = new Promise((resolve) => setTimeout(() => resolve(''), 10_000));
    return Promise.race([request, timeout]);
}
async function toCollectedItem(item, feedTitle, enableFullText) {
    const fullText = enableFullText && item.link ? await fetchFullText(item.link) : '';
    return {
        source: shared_core_1.Source.news,
        url: item.link || '',
        title: item.title || '',
        body: fullText || item.contentSnippet || item.content || '',
        author: item.creator || '',
        timestamp: item.isoDate || new Date().toISOString(),
        engagement: { upvotes: 0, comments: 0 },
        raw_replies: [],
        category: feedTitle,
    };
}
async function collectFeed(feedUrl, qLower, terms, enableFullText) {
    const feed = await parser.parseURL(feedUrl);
    const exact = [];
    const loose = [];
    await Promise.all(feed.items.map(async (item) => {
        const text = `${item.title ?? ''} ${item.contentSnippet ?? ''}`.toLowerCase();
        const tier = classifyMatch(text, qLower, terms);
        if (tier === 'none')
            return;
        const collected = await toCollectedItem(item, feed.title, enableFullText && tier === 'exact');
        if (tier === 'exact')
            exact.push(collected);
        else
            loose.push(collected);
    }));
    return { exact, loose };
}
/**
 * Collect articles from RSS/Atom feeds.
 * Optionally filter by keyword before ingesting.
 * Full-text extraction via Jina Reader (https://r.jina.ai/<url>).
 */
async function collectNewsRSS(options) {
    const { feeds, query } = options;
    const qLower = query?.trim().toLowerCase() ?? '';
    const terms = qLower ? tokenize(qLower) : [];
    const enableFullText = process.env.MIA_ENABLE_FULLTEXT === 'true';
    const settled = await Promise.allSettled(feeds.map((feedUrl) => collectFeed(feedUrl, qLower, terms, enableFullText)));
    const fulfilled = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const exact = fulfilled.flatMap((r) => r.exact);
    const loose = fulfilled.flatMap((r) => r.loose);
    return exact.length > 0 ? exact : loose;
}
//# sourceMappingURL=news-rss.js.map