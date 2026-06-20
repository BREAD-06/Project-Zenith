export const ZENITH_WINDOW = { minAlt: 75, maxAlt: 90 } as const

export type CelestialCategory = 'satellite' | 'iss' | 'planet'

export interface TopocentricPosition {
  altitude: number
  azimuth: number
  rangekm: number
}

export interface GeoPosition {
  latitude: number
  longitude: number
  heightKm: number
}

export interface ObserverLocation {
  latitude: number
  longitude: number
  altitudeM: number
  label: string
}

export interface CelestialObject {
  id: string
  name: string
  category: CelestialCategory
  geo: GeoPosition
  topo: TopocentricPosition
  inZenithWindow: boolean
  updatedAt: number
}
