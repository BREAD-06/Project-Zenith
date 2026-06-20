import * as satellite from 'satellite.js'
import type { GeoPosition, TopocentricPosition } from '@/types/celestial'

/** Earth-Centered Earth-Fixed position in kilometres. */
export interface EcefVec {
  x: number
  y: number
  z: number
}

/**
 * ECI → ECEF. `gmst` is Greenwich Mean Sidereal Time for the propagation epoch
 * (from `satellite.gstime(date)`).
 */
export function eciToEcef(positionEci: satellite.EciVec3<number>, gmst: number): EcefVec {
  return satellite.eciToEcf(positionEci, gmst)
}

/**
 * ECEF → geodetic (WGS-84). satellite.js has no direct ECEF→geodetic, but
 * `eciToGeodetic` with gmst = 0 treats the input as already Earth-fixed
 * (longitude measured from the Greenwich meridian), which is exactly the
 * geodetic conversion we want. Returns lat/long in degrees, height in km.
 */
export function ecefToGeodetic(ecef: EcefVec): GeoPosition {
  const geo = satellite.eciToGeodetic(ecef, 0)
  return {
    latitude: satellite.degreesLat(geo.latitude),
    longitude: satellite.degreesLong(geo.longitude),
    heightKm: geo.height,
  }
}

/**
 * Topocentric look angles of `targetGeo` as seen from `observerGeo`.
 * Both inputs use degrees for lat/long and km for height. Returns altitude
 * (elevation) and azimuth in degrees, range in km.
 */
export function geodeticToTopocentric(
  observerGeo: GeoPosition,
  targetGeo: GeoPosition
): TopocentricPosition {
  const observerGd: satellite.GeodeticLocation = {
    longitude: satellite.degreesToRadians(observerGeo.longitude),
    latitude: satellite.degreesToRadians(observerGeo.latitude),
    height: observerGeo.heightKm,
  }
  const targetEcf = satellite.geodeticToEcf({
    longitude: satellite.degreesToRadians(targetGeo.longitude),
    latitude: satellite.degreesToRadians(targetGeo.latitude),
    height: targetGeo.heightKm,
  })
  const look = satellite.ecfToLookAngles(observerGd, targetEcf)
  return {
    altitude: satellite.radiansToDegrees(look.elevation),
    azimuth: (satellite.radiansToDegrees(look.azimuth) + 360) % 360,
    rangekm: look.rangeSat,
  }
}
