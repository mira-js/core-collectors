// SPDX-License-Identifier: AGPL-3.0-only
import type { Result } from '@mira/shared-core'
import { requestApifyActor, type ApifyError } from './apify.js'
import { ApifyRedditPostSchema, REDDIT_ACTOR_ID } from './reddit.js'

const PROBE_TIMEOUT_SECS = 240

function bareName(subreddit: string): string {
  return subreddit.replace(/^\/?r\//i, '').toLowerCase()
}

/**
 * Check that `r/<name>` exists and is readable by running the Reddit actor
 * once against the community URL with `maxPosts: 1`.
 *
 * A missing, banned or private community comes back as an empty dataset with
 * a 2xx status, so `[]` is `ok:true, false`. A reader must treat that `false`
 * as weak: an empty dataset cannot tell "does not exist" apart from "Reddit
 * blocked the fetch". Posts from other subreddits only (a redirect) are also
 * `false`. A non-empty dataset with no parseable post is `bad-shape`.
 */
export async function probeSubreddit(name: string): Promise<Result<boolean, ApifyError>> {
  const result = await requestApifyActor(
    REDDIT_ACTOR_ID,
    {
      urls: [`https://www.reddit.com/r/${name}/`],
      maxPosts: 1,
      scrapeComments: false,
      strictTokenFilter: true,
      maximize_coverage: false,
      includeNsfw: false,
      sentiment_analysis: false,
      content_analysis: false,
    },
    { timeoutSecs: PROBE_TIMEOUT_SECS },
  )
  if (!result.ok) return result

  const raw = result.value
  if (raw.length === 0) return { ok: true, value: false }

  const posts = raw.flatMap((entry) => {
    const parsed = ApifyRedditPostSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
  if (posts.length === 0) {
    return {
      ok: false,
      error: {
        kind: 'bad-shape',
        actorId: REDDIT_ACTOR_ID,
        message: `probe for r/${name} returned ${raw.length} item(s) but none matched the expected post shape`,
      },
    }
  }

  const target = bareName(name)
  return { ok: true, value: posts.some((post) => bareName(post.subreddit) === target) }
}
