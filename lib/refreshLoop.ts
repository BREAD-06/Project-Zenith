import { ZENITH_WINDOW, isISSName } from '@/types/celestial'
import type { CelestialObject, GeoPosition } from '@/types/celestial'
import type { ZenithStore } from '@/store/zenithStore'
import type { TLEEntry, TleMessage, TickMessage, WorkerOutMessage } from './sgp4Worker'
import { geodeticToTopocentric } from './coordTransforms'

// ── Loop cadences ────────────────────────────────────────────────────────────
/** How often the simulation re-propagates positions (seconds). */
const SIM_INTERVAL_MS = 10_000

/** How often we check if fresh TLEs are needed (minutes). TLEs barely change —
 *  CelesTrak updates a few times per day — so 15 min is more than enough. */
const TLE_REFRESH_INTERVAL_MS = 15 * 60 * 1000

// Planets are now rendered as a 3D solar system (lib/solarSystem.ts) orbiting the
// globe, so the old NASA-Horizons "sky point near Earth" planets are disabled to
// avoid showing each planet twice (and two hits per planet in search). Flip to
// true to restore the geocentric Horizons sky points instead.
const USE_HORIZONS_PLANETS = false

// ── Client-side TLE cache ────────────────────────────────────────────────────
// localStorage cache survives page reloads. The in-memory `memTLE` mirror gives
// a stable reference within the TTL so TLEs are only re-posted to the worker
// when they actually change.
const TLE_CACHE_KEY = 'zenith_tle_cache'
const TLE_TTL_MS = 15 * 60 * 1000 // Must match TLE_REFRESH_INTERVAL_MS.

/** Client-side fetch timeout — if the server hasn't responded in 8 s the user
 *  already thinks something is broken, so abort and use cached data. */
const CLIENT_FETCH_TIMEOUT_MS = 8_000

/** Time Machine slider debounce — short enough to feel instant, long enough to
 *  batch rapid drags into one propagation. */
const SLIDER_DEBOUNCE_MS = 75

interface TLECacheEntry {
  data: TLEEntry[]
  timestamp: number
}

let memTLE: TLECacheEntry | null = null

function readLocalCache(): TLECacheEntry | null {
  try {
    const raw = localStorage.getItem(TLE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as TLECacheEntry
    if (!parsed || !Array.isArray(parsed.data) || typeof parsed.timestamp !== 'number') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeLocalCache(entry: TLECacheEntry): void {
  try {
    localStorage.setItem(TLE_CACHE_KEY, JSON.stringify(entry))
  } catch {
    // Quota exceeded or unavailable — caching is best-effort.
  }
}

// ── Exponential backoff for TLE fetch failures ───────────────────────────────
const BACKOFF_STEPS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 5 * 60_000]
let backoffIndex = 0
let backoffHandle: ReturnType<typeof setTimeout> | null = null

function resetBackoff() {
  backoffIndex = 0
  if (backoffHandle) {
    clearTimeout(backoffHandle)
    backoffHandle = null
  }
}

// ── TLE fetch (client → /api/tle) ────────────────────────────────────────────

/** Fetch TLEs from our server route with a client-side timeout. */
async function fetchTLEsOnce(): Promise<TLEEntry[]> {
  const res = await fetch('/api/tle', {
    signal: AbortSignal.timeout(CLIENT_FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    const err = new Error(`TLE API responded ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.satellites as TLEEntry[]
}

/**
 * Return TLEs from the client-side cache, refreshing from the server only when
 * the cache is stale. On failure, falls back to any cached (even stale) TLEs
 * rather than crashing the tick.
 */
async function getTLEs(): Promise<TLEEntry[]> {
  const now = Date.now()
  if (memTLE && now - memTLE.timestamp < TLE_TTL_MS) return memTLE.data

  const cached = readLocalCache()
  if (cached && now - cached.timestamp < TLE_TTL_MS) {
    memTLE = cached
    return cached.data
  }

  const store = (data: TLEEntry[]): TLEEntry[] => {
    const entry: TLECacheEntry = { data, timestamp: Date.now() }
    memTLE = entry
    writeLocalCache(entry)
    resetBackoff()
    return data
  }

  try {
    return store(await fetchTLEsOnce())
  } catch (err) {
    console.warn('[refreshLoop] TLE fetch failed:', err)
    // Serve a stale cache if we have one rather than failing.
    if (cached) {
      memTLE = cached
      return cached.data
    }
    if (memTLE) return memTLE.data
    throw err
  }
}

// ── ISS live overlay ─────────────────────────────────────────────────────────

/** Live ISS position shape returned by our /api/iss route (OpenNotify-fed). */
interface ISSLivePosition {
  latitude: number
  longitude: number
  altitudeKm: number
  timestampMs: number
}

/**
 * Promote the ISS within a freshly-propagated catalogue: force its category to
 * 'iss' (so the marker renders at #ffcc02), then overlay the live OpenNotify
 * position from /api/iss — which is NASA-fed and more accurate than our SGP4
 * propagation. Topocentric Alt/Az and the Zenith-Window flag are recomputed from
 * the live position before the store update.
 *
 * Best-effort: if /api/iss fails (or the ISS isn't in the catalogue), the SGP4
 * position is kept and a warning logged. The ISS object is never dropped.
 *
 * Mutates `objects` in place and resolves with it for convenience.
 */
async function promoteISS(
  objects: CelestialObject[],
  observer: { latitude: number; longitude: number; altitudeM: number }
): Promise<CelestialObject[]> {
  // Same matcher the worker categorises with, so we promote exactly the object
  // it tagged 'iss' — no second ISS, no mismatch.
  const iss = objects.find((o) => isISSName(o.name))
  if (!iss) return objects

  // Promote the category regardless of whether the live overlay succeeds.
  iss.category = 'iss'

  try {
    const res = await fetch('/api/iss')
    if (!res.ok) throw new Error(`/api/iss responded ${res.status}`)
    const live = (await res.json()) as ISSLivePosition
    if (
      !Number.isFinite(live.latitude) ||
      !Number.isFinite(live.longitude) ||
      !Number.isFinite(live.altitudeKm)
    ) {
      throw new Error('/api/iss returned a malformed position')
    }

    const geo: GeoPosition = {
      latitude: live.latitude,
      longitude: live.longitude,
      heightKm: live.altitudeKm,
    }
    const observerGeo: GeoPosition = {
      latitude: observer.latitude,
      longitude: observer.longitude,
      heightKm: observer.altitudeM / 1000,
    }
    const topo = geodeticToTopocentric(observerGeo, geo)

    iss.geo = geo
    // Hold steady at the live position rather than letting Cesium interpolate
    // toward the now-inconsistent SGP4 forecast point.
    iss.geoNext = geo
    iss.topo = topo
    iss.inZenithWindow =
      topo.altitude >= ZENITH_WINDOW.minAlt && topo.altitude <= ZENITH_WINDOW.maxAlt
    iss.updatedAt = live.timestampMs || Date.now()
  } catch (err) {
    console.warn('[refreshLoop] live ISS position unavailable, keeping SGP4:', err)
  }

  return objects
}

// ── Planet fetching (disabled by default) ────────────────────────────────────

/** Planet entry shape returned by our /api/planets route (NASA Horizons-fed). */
interface PlanetApiObject {
  id: string
  name: string
  category: 'planet'
  geoPosition: GeoPosition
}

/**
 * Fetch the current planet positions from /api/planets and turn each into a
 * CelestialObject, computing topocentric Alt/Az against `observer` and the
 * Zenith-Window flag from the API's geodetic position.
 *
 * Best-effort: a 503 (Horizons unreachable, no cache) or any other failure
 * logs a warning and returns [] so planets are simply skipped this tick — the
 * pipeline never crashes.
 */
async function fetchPlanetObjects(
  observer: { latitude: number; longitude: number; altitudeM: number },
  now: number
): Promise<CelestialObject[]> {
  try {
    const res = await fetch('/api/planets')
    if (!res.ok) {
      console.warn(`[refreshLoop] /api/planets responded ${res.status} — skipping planets this tick`)
      return []
    }
    const planets = (await res.json()) as PlanetApiObject[]
    if (!Array.isArray(planets)) return []

    const observerGeo: GeoPosition = {
      latitude: observer.latitude,
      longitude: observer.longitude,
      heightKm: observer.altitudeM / 1000,
    }

    return planets.map((p) => {
      const topo = geodeticToTopocentric(observerGeo, p.geoPosition)
      return {
        id: `planet-${p.name.toLowerCase()}`,
        name: p.name,
        category: 'planet' as const,
        geo: p.geoPosition,
        topo,
        inZenithWindow:
          topo.altitude >= ZENITH_WINDOW.minAlt && topo.altitude <= ZENITH_WINDOW.maxAlt,
        updatedAt: now,
      }
    })
  } catch (err) {
    console.warn('[refreshLoop] planet fetch failed, skipping planets this tick:', err)
    return []
  }
}

// ── Worker communication ─────────────────────────────────────────────────────

/**
 * Ask the worker to propagate its currently-loaded TLEs for `observer` and
 * resolve with the propagated CelestialObject[]. Rejects if the worker errors.
 */
function runPropagation(
  worker: Worker,
  observer: TickMessage['observer'],
  intervalMs: number,
  offsetMs: number
): Promise<CelestialObject[]> {
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data
      if (msg.type === 'result') {
        detach()
        resolve(msg.objects)
      } else if (msg.type === 'error') {
        detach()
        reject(new Error(msg.message))
      }
      // 'loading' messages are ignored — the loop tracks dataLoading itself.
    }
    const onError = (e: ErrorEvent) => {
      detach()
      reject(new Error(e.message || 'Worker error'))
    }
    const detach = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.postMessage({ type: 'tick', observer, intervalMs, offsetMs } satisfies TickMessage)
  })
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Start the real-time refresh loops. Two independent loops run concurrently:
 *
 *  **Loop A — TLE Refresh** (every 15 min):
 *    Fetches fresh TLEs from /api/tle and pushes them to the worker. This is the
 *    only loop that touches the network. On failure it uses exponential backoff
 *    (1 s → 5 min) and falls back to cached data.
 *
 *  **Loop B — Simulation** (every 10 s):
 *    Propagates the worker's cached TLEs for the current observer + time offset.
 *    Zero network calls. Also overlays the ISS live position (skipped during
 *    Time Machine mode). Skips ticks when `simulationActive === false`.
 *
 *  **Time Machine slider** (75 ms debounce):
 *    On offset change, immediately re-propagates using the worker's cached TLEs.
 *    No network calls, no ISS overlay. Cancel-on-supersede via a generation
 *    counter so only the latest slider position renders.
 *
 * Returns a `stopRefreshLoop` cleanup that tears everything down.
 *
 * @param store      The Zustand store instance (dependency-injected).
 * @param intervalMs Simulation cadence in milliseconds (default 10 000).
 */
export function startRefreshLoop(
  store: ZenithStore,
  intervalMs: number = SIM_INTERVAL_MS
): () => void {
  let worker: Worker
  try {
    worker = new Worker(new URL('./sgp4Worker.ts', import.meta.url))
  } catch (err) {
    console.error('[refreshLoop] Failed to create Web Worker:', err)
    store.getState().setLastError('Web Worker unavailable')
    return () => {}
  }

  let stopped = false

  // The TLE array reference last sent to the worker — only re-send on change.
  let lastSentTLE: TLEEntry[] | null = null

  // Guard against simulation ticks overlapping (e.g. a slow propagation).
  let simInFlight = false

  // ── Generation counter for Time Machine cancel-on-supersede ──────────────
  // Each slider event increments this. When a propagation result arrives, if
  // its generation doesn't match `sliderGen`, it's discarded — only the most
  // recent slider position renders.
  let sliderGen = 0

  // Debounce handle for Time Machine slider.
  let sliderDebounce: ReturnType<typeof setTimeout> | null = null

  // ═══════════════════════════════════════════════════════════════════════════
  // Loop A — TLE Refresh (background, every 15 min)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Push fresh TLEs to the worker if the cache is stale. On failure, schedule
   * an exponential-backoff retry. Never blocks the simulation loop.
   */
  const tleTick = async () => {
    if (stopped) return
    // Respect the simulationActive flag — don't fetch when paused.
    if (!store.getState().simulationActive) return

    try {
      const tles = await getTLEs()
      if (stopped) return

      // Push TLEs to the worker only when they actually change.
      if (tles !== lastSentTLE) {
        worker.postMessage({ type: 'tle', satellites: tles } satisfies TleMessage)
        lastSentTLE = tles
      }
    } catch (err) {
      console.error('[refreshLoop] TLE refresh failed:', err)
      store.getState().setLastError(err instanceof Error ? err.message : String(err))

      // Schedule an exponential-backoff retry.
      if (!stopped) {
        const delayMs = BACKOFF_STEPS[Math.min(backoffIndex, BACKOFF_STEPS.length - 1)]
        backoffIndex++
        console.warn(`[refreshLoop] TLE retry in ${delayMs / 1000}s (backoff #${backoffIndex})`)
        backoffHandle = setTimeout(() => {
          backoffHandle = null
          void tleTick()
        }, delayMs)
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Loop B — Simulation (every 10 s, zero network)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Propagate the worker's cached TLEs for the current observer + time offset.
   * Overlays the live ISS position (skipped when Time Machine is active).
   * No network calls to /api/tle — the worker already has everything.
   */
  const simTick = async () => {
    if (stopped || simInFlight) return
    // Sleep mode: skip ticks but keep the worker alive.
    if (!store.getState().simulationActive) return

    simInFlight = true
    const { observer, offsetHours, upsertObjects, setDataLoading, setLastError } = store.getState()
    setDataLoading(true)

    try {
      // Propagate in the worker → updated CelestialObject[].
      const updatedObjects = await runPropagation(
        worker,
        {
          latitude: observer.latitude,
          longitude: observer.longitude,
          altitudeM: observer.altitudeM,
        },
        intervalMs,
        offsetHours * 3_600_000
      )
      if (stopped) return

      // Overlay the ISS with its live OpenNotify position — but only when
      // viewing "now" (offset 0). In Time Machine mode the ISS's current
      // real position is irrelevant.
      if (offsetHours === 0) {
        await promoteISS(updatedObjects, observer)
        if (stopped) return
      }

      // Append planets from NASA Horizons (best-effort — skipped on failure).
      // Disabled by default — planets are drawn by the 3D solar-system module now.
      if (USE_HORIZONS_PLANETS) {
        const planets = await fetchPlanetObjects(observer, Date.now())
        if (stopped) return
        updatedObjects.push(...planets)
      }

      // Push the new positions into the store.
      upsertObjects(updatedObjects)
      setLastError(null)
    } catch (err) {
      // Never crash the loop — log the error and skip this tick.
      console.error('[refreshLoop] sim tick failed, skipping:', err)
      setLastError(err instanceof Error ? err.message : String(err))
    } finally {
      simInFlight = false
      if (!stopped) setDataLoading(false)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Time Machine — instant re-propagation (75 ms debounce, no network)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * When the Time Machine slider moves, propagate using the worker's cached
   * TLEs at the new time offset. No network calls, no ISS overlay, no planet
   * fetch. Cancel-on-supersede ensures only the latest slider value renders.
   */
  const sliderTick = async (gen: number) => {
    if (stopped) return

    const { observer, offsetHours, upsertObjects, setDataLoading } = store.getState()
    setDataLoading(true)

    try {
      const updatedObjects = await runPropagation(
        worker,
        {
          latitude: observer.latitude,
          longitude: observer.longitude,
          altitudeM: observer.altitudeM,
        },
        intervalMs,
        offsetHours * 3_600_000
      )
      if (stopped) return

      // Cancel-on-supersede: discard if a newer slider event already fired.
      if (gen !== sliderGen) return

      upsertObjects(updatedObjects)
    } catch (err) {
      console.error('[refreshLoop] slider propagation failed:', err)
    } finally {
      if (!stopped) setDataLoading(false)
    }
  }

  // ── Subscribe to Time Machine offset changes ──────────────────────────────
  const unsubOffset = store.subscribe(
    (s) => s.offsetHours,
    () => {
      if (stopped) return
      if (sliderDebounce) clearTimeout(sliderDebounce)
      const gen = ++sliderGen
      sliderDebounce = setTimeout(() => {
        sliderDebounce = null
        void sliderTick(gen)
      }, SLIDER_DEBOUNCE_MS)
    }
  )

  // ── Kick off both loops ────────────────────────────────────────────────────

  // 1. TLE refresh: fetch immediately, then every 15 min.
  void tleTick()
  const tleHandle = setInterval(() => void tleTick(), TLE_REFRESH_INTERVAL_MS)

  // 2. Simulation: first tick after a short delay to give the TLE fetch a
  //    chance to complete, then every 10 s.
  const firstSimDelay = setTimeout(() => void simTick(), 2_000)
  const simHandle = setInterval(() => void simTick(), intervalMs)

  // ── Cleanup ────────────────────────────────────────────────────────────────
  return function stopRefreshLoop() {
    stopped = true
    clearInterval(tleHandle)
    clearInterval(simHandle)
    clearTimeout(firstSimDelay)
    if (sliderDebounce) clearTimeout(sliderDebounce)
    resetBackoff()
    unsubOffset()
    worker.terminate()
  }
}
