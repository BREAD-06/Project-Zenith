/**
 * Coordinate + visibility utilities for the /constellations viewer.
 *
 * Pure math, with the single exception of raDecToCartesian, which needs the
 * Cesium runtime to build a Cartesian3. Following this codebase's dynamic-import
 * convention (Cesium is only ever loaded client-side via `await import('cesium')`),
 * the Cesium module is PASSED IN to that helper rather than imported at the top of
 * this file — a top-level `import 'cesium'` would touch `window` and break SSR of
 * any client component that pulls these utils in. Types come from a `import type`,
 * which is erased at compile time and is safe everywhere.
 */

import type * as CesiumTypes from 'cesium'
import { CONSTELLATIONS, type ConstellationData } from './constellationData'

/** Radius of the rendered celestial sphere, in scene metres. Far beyond the
 *  solar-system orrery so the stars read as an enclosing dome of fixed stars. */
export const CELESTIAL_RADIUS_M = 5_000_000_000

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

/** Convert right ascension expressed in hours (0–24) to degrees (0–360). */
export function raToDeg(raHours: number): number {
  return raHours * 15
}

/**
 * Project a celestial (RA, Dec) coordinate onto a sphere of the given radius,
 * returning the scene Cartesian3. RA maps to the longitude angle and Dec to the
 * latitude angle, matching the standard equatorial-to-cartesian transform.
 */
export function raDecToCartesian(
  Cesium: typeof CesiumTypes,
  raDeg: number,
  decDeg: number,
  radiusM: number = CELESTIAL_RADIUS_M,
): CesiumTypes.Cartesian3 {
  const raRad = Cesium.Math.toRadians(raDeg)
  const decRad = Cesium.Math.toRadians(decDeg)
  const x = radiusM * Math.cos(decRad) * Math.cos(raRad)
  const y = radiusM * Math.cos(decRad) * Math.sin(raRad)
  const z = radiusM * Math.sin(decRad)
  return new Cesium.Cartesian3(x, y, z)
}

/**
 * Great-circle (Haversine) separation between two celestial coordinates,
 * returned in degrees. Treats RA as longitude and Dec as latitude on the sphere.
 */
export function angularDistance(
  ra1: number,
  dec1: number,
  ra2: number,
  dec2: number,
): number {
  const dDec = (dec2 - dec1) * DEG2RAD
  const dRa = (ra2 - ra1) * DEG2RAD
  const a =
    Math.sin(dDec / 2) ** 2 +
    Math.cos(dec1 * DEG2RAD) * Math.cos(dec2 * DEG2RAD) * Math.sin(dRa / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return c * RAD2DEG
}

/** Normalise an angle in degrees into the [0, 360) range. */
function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * Local Sidereal Time (degrees) for the given longitude, right now. This equals
 * the right ascension currently crossing the observer's meridian — i.e. the RA of
 * the zenith. Standard low-precision GMST formula plus the observer's longitude.
 */
export function localSiderealTime(observerLng: number): number {
  const lst =
    280.46061837 +
    360.98564736629 * (Date.now() / 86400000 - 10957.5) +
    observerLng
  return wrap360(lst)
}

/** The current zenith point (RA, Dec) for an observer — RA = LST, Dec = latitude. */
function zenith(observerLat: number, observerLng: number): { ra: number; dec: number } {
  return { ra: localSiderealTime(observerLng), dec: observerLat }
}

/** A constellation paired with how far its centre sits from the observer's zenith. */
export interface RankedConstellation {
  constellation: ConstellationData
  /** Angular distance from the zenith, degrees (0 = directly overhead). */
  zenithDistance: number
  /** Approximate altitude of the constellation's centre, degrees (90 − distance). */
  altitude: number
}

/**
 * All constellations ranked by how close their centre is to the observer's zenith
 * (the point 90° up). Nearest-first, ties broken alphabetically by id. The first
 * entry is the constellation currently closest to straight overhead.
 */
export function rankConstellationsByZenithDistance(
  observerLat: number,
  observerLng: number,
): RankedConstellation[] {
  const z = zenith(observerLat, observerLng)
  return CONSTELLATIONS.map((c) => {
    const d = angularDistance(z.ra, z.dec, c.centerRa, c.centerDec)
    return { constellation: c, zenithDistance: d, altitude: 90 - d }
  }).sort((a, b) =>
    a.zenithDistance !== b.zenithDistance
      ? a.zenithDistance - b.zenithDistance
      : a.constellation.id.localeCompare(b.constellation.id),
  )
}

/**
 * Every constellation that can be above the observer's horizon (its centre
 * declination lies within ±90° of the observer's latitude), sorted nearest-first
 * by angular distance from the observer's zenith.
 */
export function getVisibleConstellations(
  observerLat: number,
  observerLng: number,
): ConstellationData[] {
  const z = zenith(observerLat, observerLng)
  return CONSTELLATIONS.filter(
    (c) => c.centerDec >= observerLat - 90 && c.centerDec <= observerLat + 90,
  ).sort((a, b) => {
    const da = angularDistance(z.ra, z.dec, a.centerRa, a.centerDec)
    const db = angularDistance(z.ra, z.dec, b.centerRa, b.centerDec)
    // Tie-break equidistant constellations by id, alphabetically (NOTES).
    return da !== db ? da - db : a.id.localeCompare(b.id)
  })
}

/**
 * The constellation currently nearly overhead (within 20° of the zenith), or
 * null if none is that close.
 */
export function getOverheadConstellation(
  observerLat: number,
  observerLng: number,
): ConstellationData | null {
  const nearest = getNearestConstellation(observerLat, observerLng)
  const z = zenith(observerLat, observerLng)
  const d = angularDistance(z.ra, z.dec, nearest.centerRa, nearest.centerDec)
  return d < 20 ? nearest : null
}

/** The constellation whose centre is closest to the observer's zenith right now. */
export function getNearestConstellation(
  observerLat: number,
  observerLng: number,
): ConstellationData {
  const z = zenith(observerLat, observerLng)
  let best = CONSTELLATIONS[0]
  let bestDist = Infinity
  for (const c of CONSTELLATIONS) {
    const d = angularDistance(z.ra, z.dec, c.centerRa, c.centerDec)
    // Strictly-closer wins; on an exact tie keep the alphabetically lower id (NOTES).
    if (d < bestDist || (d === bestDist && c.id.localeCompare(best.id) < 0)) {
      bestDist = d
      best = c
    }
  }
  return best
}
