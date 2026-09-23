import type { Result } from '@mira/shared-core'

export interface ApifyError {
  kind: 'missing-token' | 'network' | 'http-status' | 'bad-shape'
  actorId: string
  status?: number
  message: string
}

export interface ApifyRunOptions {
  timeoutSecs?: number
}

/**
 * Run an Apify actor synchronously and return its dataset items.
 *
 * Every failure path is reported as `err(ApifyError)` — nothing is swallowed.
 * Requires `APIFY_API_TOKEN`.
 */
export async function requestApifyActor(
  actorId: string,
  input: Record<string, unknown>,
  options?: ApifyRunOptions,
): Promise<Result<unknown[], ApifyError>> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) {
    return {
      ok: false,
      error: { kind: 'missing-token', actorId, message: 'APIFY_API_TOKEN is not set' },
    }
  }

  const timeoutSecs = options?.timeoutSecs ?? 120
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${token}&timeout=${timeoutSecs}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((timeoutSecs + 5) * 1000),
    })
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'network',
        actorId,
        message: error instanceof Error ? error.message : 'fetch error',
      },
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      error: {
        kind: 'http-status',
        actorId,
        status: res.status,
        message: `Apify returned HTTP ${res.status}`,
      },
    }
  }

  let json: unknown
  try {
    json = await res.json()
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'bad-shape',
        actorId,
        message: error instanceof Error ? error.message : 'response body was not JSON',
      },
    }
  }

  if (!Array.isArray(json)) {
    return {
      ok: false,
      error: { kind: 'bad-shape', actorId, message: 'response body was not an array' },
    }
  }

  return { ok: true, value: json }
}
