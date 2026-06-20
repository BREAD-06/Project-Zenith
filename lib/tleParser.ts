import * as satellite from 'satellite.js'

/**
 * A satellite.js satrec with the source object name attached for convenience,
 * so downstream code can carry the name alongside the propagation record.
 */
export type NamedSatRec = satellite.SatRec & { name: string }

/** ECI state vectors (km and km/s) produced by SGP4 propagation. */
export interface EciState {
  positionEci: satellite.EciVec3<number>
  velocityEci: satellite.EciVec3<number>
}

/**
 * Parse a TLE (two line element set) into a satellite.js satrec via SGP4 init.
 */
export function parseTLE(line1: string, line2: string, name: string): NamedSatRec {
  const satrec = satellite.twoline2satrec(line1, line2) as NamedSatRec
  satrec.name = name
  return satrec
}

/**
 * Propagate a satrec to `date`, returning ECI position/velocity, or null if
 * SGP4 failed (e.g. decayed orbit, out-of-range eccentricity).
 */
export function propagate(satrec: satellite.SatRec, date: Date): EciState | null {
  const pv = satellite.propagate(satrec, date)
  if (pv === null || satrec.error !== satellite.SatRecError.None) {
    return null
  }
  return { positionEci: pv.position, velocityEci: pv.velocity }
}
