// Module-level TTL cache wrapper.
//
// React.cache() dedupes calls within a single render. ttlCache() dedupes
// across renders for `ttlMs` milliseconds, by keying on the function
// arguments. Use it on loaders whose data changes infrequently (labels,
// channels, clients, campaigns, lists, views) so concurrent users hitting
// the same workspace don't each re-fetch the same lookup tables.
//
// Compose with React.cache() like:
//   export const loadX = cache(ttlCache(_loadX, { ttlMs: 30_000 }));
//
// Safety: cache key includes every argument, so workspace isolation works
// out of the box. Only wrap loaders whose result is identical for every
// caller with the same arguments (i.e. workspace-wide data, not
// per-user-filtered data).

type Entry<T> = { data: T; expiresAt: number; promise?: Promise<T> };

export function ttlCache<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: { ttlMs?: number; key?: (...args: TArgs) => string } = {},
): (...args: TArgs) => Promise<TResult> {
  const { ttlMs = 30_000, key = (...args) => JSON.stringify(args) } = options;
  const store = new Map<string, Entry<TResult>>();

  return async (...args: TArgs): Promise<TResult> => {
    const k = key(...args);
    const now = Date.now();
    const hit = store.get(k);
    if (hit && hit.expiresAt > now) return hit.data;
    // In-flight dedup: if another caller is already fetching, await its
    // promise instead of firing a duplicate request.
    if (hit?.promise) return hit.promise;
    const promise = fn(...args).then(
      (data) => {
        store.set(k, { data, expiresAt: Date.now() + ttlMs });
        return data;
      },
      (err) => {
        // Don't poison the cache on error — let the next caller retry.
        store.delete(k);
        throw err;
      },
    );
    store.set(k, { data: hit?.data as TResult, expiresAt: 0, promise });
    return promise;
  };
}
