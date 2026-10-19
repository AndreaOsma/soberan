// Client-side (WebView) mirror of the last successful fetch for every core/month
// dataset + settings, hydrated synchronously into useSoberanData's useState lazy
// initializers — the very first render already has the last-known data instead of
// empty arrays that silently fill in a beat later once the network round-trip (even
// a local one, to the embedded backend) resolves. loadAll()/loadMonthData()/
// loadSettings() write through to this on every successful fetch, so it's never
// more than one load cycle stale.
const CACHE_PREFIX = "soberan-cache-v1:";

export function readCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw !== null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or localStorage unavailable (private mode) — caching is a nice-to-
    // have for instant paint, never required for correctness, so this is silently skipped.
  }
}

// Written once loadCoreData() has ever succeeded — checked synchronously (not via an
// effect) to seed `loading`'s initial value. Populating accounts/transactions/etc. from
// cache alone wasn't enough: AppShell renders <ViewSkeleton> in place of real content for
// as long as `loading` is true, and that used to start true unconditionally, hiding the
// already-hydrated cached data behind a skeleton until the real network round trip
// finished anyway — the exact "still slow to load" a second app open shouldn't be.
export function hasCachedSnapshot(): boolean {
  try {
    return localStorage.getItem(CACHE_PREFIX + "hasSnapshot") === "1";
  } catch {
    return false;
  }
}

export function markCachedSnapshot(): void {
  try {
    localStorage.setItem(CACHE_PREFIX + "hasSnapshot", "1");
  } catch {
    // best-effort, see writeCache
  }
}
