import * as satellite from 'satellite.js'
import { parseTLE, propagate } from '@/lib/tleParser'
import { eciToEcef, ecefToGeodetic, geodeticToTopocentric } from '@/lib/coordTransforms'
import { useZenithStore } from '@/store/zenithStore'
import { ZENITH_WINDOW } from '@/types/celestial'
import type { CelestialCategory, CelestialObject, GeoPosition } from '@/types/celestial'

interface TLEEntry {
  name: string
  line1: string
  line2: string
}

interface TLEResponse {
  satellites: TLEEntry[]
  error?: string
}

function categorize(name: string): CelestialCategory {
  const upper = name.toUpperCase()
  return upper.includes('ISS') || upper.includes('ZARYA') ? 'iss' : 'satellite'
}

/**
 * One pipeline tick: fetch TLEs, propagate to now, compute topocentric Alt/Az
 * relative to the current observer, and push results into the store.
 */
async function tick(): Promise<void> {
  const { setDataLoading, setLastError, upsertObjects } = useZenithStore.getState()
  setDataLoading(true)
  try {
    const res = await fetch('/api/tle')
    if (!res.ok) {
      throw new Error(`TLE API responded ${res.status}`)
    }
    const data: TLEResponse = await res.json()
    if (data.error) {
      throw new Error(data.error)
    }

    const now = new Date()
    const gmst = satellite.gstime(now)

    // Read observer fresh from the store — the pipeline runs outside React.
    const observer = useZenithStore.getState().observer
    const observerGeo: GeoPosition = {
      latitude: observer.latitude,
      longitude: observer.longitude,
      heightKm: observer.altitudeM / 1000,
    }

    const objects: CelestialObject[] = []
    for (const sat of data.satellites) {
      const satrec = parseTLE(sat.line1, sat.line2, sat.name)
      const eci = propagate(satrec, now)
      if (!eci) continue

      const ecef = eciToEcef(eci.positionEci, gmst)
      const geo = ecefToGeodetic(ecef)
      const topo = geodeticToTopocentric(observerGeo, geo)

      objects.push({
        id: satrec.satnum,
        name: sat.name,
        category: categorize(sat.name),
        geo,
        topo,
        inZenithWindow:
          topo.altitude >= ZENITH_WINDOW.minAlt && topo.altitude <= ZENITH_WINDOW.maxAlt,
        updatedAt: now.getTime(),
      })
    }

    // DEBUG: confirm the coordinate transform yields sane altitudes (degrees).
    // ecfToLookAngles returns elevation in radians; coordTransforms already
    // converts to degrees, so these should read like real elevations (-90..90).
    console.log(
      '[pipeline] first 5 alt:',
      objects
        .slice(0, 5)
        .map((o) => `${o.name.trim()}=${o.topo.altitude.toFixed(1)}°`)
        .join('  ')
    )
    const maxAlt = objects.reduce((m, o) => Math.max(m, o.topo.altitude), -Infinity)
    const inWindow = objects.filter((o) => o.inZenithWindow).length
    console.log(
      `[pipeline] ${objects.length} sats | max alt ${maxAlt.toFixed(1)}° | in zenith window: ${inWindow}`
    )

    upsertObjects(objects)
    setLastError(null)
  } catch (err) {
    setLastError(err instanceof Error ? err.message : String(err))
  } finally {
    setDataLoading(false)
  }
}

/**
 * Start the data pipeline: runs immediately, then every `intervalMs`.
 * Returns a cleanup function that stops the interval.
 */
export function startPipeline(intervalMs = 10000): () => void {
  void tick()
  const handle = setInterval(() => {
    void tick()
  }, intervalMs)
  return () => clearInterval(handle)
}
