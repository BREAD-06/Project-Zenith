import { NextResponse } from 'next/server'

// All CelesTrak fetches go through this server route (never the browser) to
// avoid CORS. We use the single stable GP "active" group — the full catalogue of
// on-orbit objects — instead of fetching several groups in parallel, which was
// tripping CelesTrak's rate limit and returning 502s. (FORMAT=tle, not json, so
// the propagation pipeline's twoline2satrec keeps working unchanged.)
const SOURCES = [
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',
]

// Staleness threshold: once the cache is older than this we trigger a background
// refresh on the next request. The cached data is still returned immediately
// (stale-while-revalidate) so the client never waits.
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

// Hard timeout for CelesTrak fetches — 8 s keeps the serverless function
// within Vercel Hobby's 10 s execution limit.
const FETCH_TIMEOUT_MS = 8_000

export const dynamic = 'force-dynamic'

interface TLEEntry {
  name: string
  line1: string
  line2: string
}

interface TLEPayload {
  satellites: TLEEntry[]
}

let cache: { at: number; data: TLEPayload } | null = null

// Per-feed cache of the last successfully-parsed TLEs. CelesTrak returns
// "GP data has not updated since your last successful request" (no TLE lines,
// so parsed as 0 entries) when a group is re-polled before its dataset
// refreshes; in that case we reuse the feed's last-good list so it doesn't
// drop out of the merged catalogue.
const feedCache = new Map<string, TLEEntry[]>()

// Guard: only one background refresh at a time.
let bgRefreshInFlight = false

/** Parse raw CelesTrak TLE text (name line, line 1, line 2, repeating). */
function parseTLEText(text: string): TLEEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)

  const entries: TLEEntry[] = []
  for (let i = 0; i + 3 <= lines.length; i += 3) {
    const name = lines[i].trim()
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]
    if (line1.startsWith('1 ') && line2.startsWith('2 ')) {
      entries.push({ name, line1, line2 })
    }
  }
  return entries
}

/**
 * Fetch all SOURCES, merge, de-duplicate, and return the TLE payload.
 * Throws if every source fails and no per-feed fallback is available.
 */
async function fetchAndMergeTLEs(): Promise<TLEPayload> {
  const results = await Promise.all(
    SOURCES.map(async (url) => {
      try {
        const r = await fetch(url, {
          cache: 'no-store',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { 'User-Agent': 'ProjectZenith/1.0 (Aaruush celestial tracker)' },
        })
        if (!r.ok) return { url, entries: null as TLEEntry[] | null }
        const parsed = parseTLEText(await r.text())
        return { url, entries: parsed.length > 0 ? parsed : null }
      } catch {
        return { url, entries: null as TLEEntry[] | null }
      }
    })
  )

  // Use each feed's fresh entries, falling back to its last-good cache when
  // CelesTrak throttles it (empty/non-TLE response).
  const perFeed: TLEEntry[][] = []
  for (const { url, entries } of results) {
    if (entries) {
      feedCache.set(url, entries)
      perFeed.push(entries)
    } else {
      const last = feedCache.get(url)
      if (last) perFeed.push(last)
    }
  }
  if (perFeed.length === 0) {
    throw new Error('All CelesTrak sources failed')
  }

  // Merge all feeds, de-duplicating by satellite name.
  const seen = new Set<string>()
  const satellites: TLEEntry[] = []
  for (const entries of perFeed) {
    for (const entry of entries) {
      if (seen.has(entry.name)) continue
      seen.add(entry.name)
      satellites.push(entry)
    }
  }

  return { satellites }
}

/**
 * Non-blocking background refresh: fetches fresh TLEs and silently updates the
 * server-side cache. If the fetch fails, the existing cache is kept — the error
 * is only logged, never surfaced to the client.
 */
function triggerBackgroundRefresh(): void {
  if (bgRefreshInFlight) return
  bgRefreshInFlight = true

  fetchAndMergeTLEs()
    .then((data) => {
      cache = { at: Date.now(), data }
    })
    .catch((err) => {
      // Keep the existing (stale) cache — the client never sees this error.
      console.warn('[api/tle] Background refresh failed, keeping stale cache:', err)
    })
    .finally(() => {
      bgRefreshInFlight = false
    })
}

export async function GET() {
  // ── Stale-while-revalidate ────────────────────────────────────────────────
  // If we have ANY cached data, return it immediately. If it's stale, kick off
  // a non-blocking background refresh so the *next* request gets fresh data.
  // The client never waits on CelesTrak.
  if (cache) {
    if (Date.now() - cache.at >= CACHE_TTL_MS) {
      triggerBackgroundRefresh()
    }
    return NextResponse.json(cache.data)
  }

  // ── Cold start (no cache at all) ──────────────────────────────────────────
  // This is the only path that blocks. Happens once on first server boot.
  try {
    const data = await fetchAndMergeTLEs()
    cache = { at: Date.now(), data }
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ satellites: [], error: message }, { status: 502 })
  }
}
