import { defaultFetch } from 'lockgraph'
import type { Limiter } from 'lockgraph'

// How many registry requests may be in flight at once. The lib's default limiter
// is unbounded (`task => task()`), so on a large tree the parallel packument
// prefetch can burst hundreds of sockets at a private registry. A shared, bounded
// pool caps that without meaningfully slowing the common case. Only affects
// request *timing* — the lib resolves versions sequentially, so the lock is
// byte-identical whatever the concurrency.
export const MAX_CONCURRENCY = 16

/**
 * A `Limiter` (`<T>(task) => Promise<T>`) that runs at most `concurrency` tasks
 * concurrently, queueing the rest FIFO. One instance is shared across every
 * per-registry adapter so the bound is global, not per-host.
 */
export const createLimiter = (concurrency: number): Limiter => {
  const cap = Math.max(1, concurrency)
  let active = 0
  const queue: (() => void)[] = []
  const pump = (): void => {
    while (active < cap && queue.length > 0) {
      const run = queue.shift()
      if (!run) break
      active++
      run()
    }
  }
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--
            pump()
          })
      })
      pump()
    })
}

/**
 * Wrap a `fetch` with an in-memory response cache so the completion's
 * walk-then-resolve never fetches the same packument twice. Keyed by URL, **GET
 * only** — a POST (the audit bulk endpoint) always passes straight through, so no
 * request body is ever memoized and a re-audit re-queries. Each caller gets a
 * fresh `.clone()` (an un-read cached response) so bodies can be read
 * independently; error responses (`!ok`) and network failures are evicted so a
 * transient 5xx / dropped socket never poisons the rest of the run.
 */
export const cachingFetch = (
  base: typeof fetch = defaultFetch,
): typeof fetch => {
  const cache = new Map<string, Promise<Response>>()
  const wrapped = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const method = String(
      init?.method ?? (input as { method?: string })?.method ?? 'GET',
    ).toUpperCase()
    if (method !== 'GET') return base(input, init)
    const url =
      typeof input === 'string'
        ? input
        : ((input as { url?: string })?.url ?? String(input))
    let inflight = cache.get(url)
    if (!inflight) {
      inflight = base(input, init)
        .then((r) => {
          if (!r.ok) cache.delete(url) // don't memoize an error — allow a retry
          return r
        })
        .catch((e) => {
          cache.delete(url) // network failure — evict so it isn't poisoned
          throw e
        })
      cache.set(url, inflight)
    }
    return inflight.then((r) => r.clone())
  }
  return wrapped as typeof fetch
}

/** Fresh shared transport (bounded pool + GET cache) for one build call. */
export const buildTransport = (): { fetch: typeof fetch; limit: Limiter } => ({
  fetch: cachingFetch(defaultFetch),
  limit: createLimiter(MAX_CONCURRENCY),
})
