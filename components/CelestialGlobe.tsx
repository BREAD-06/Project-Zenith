'use client'

import { useEffect, useRef } from 'react'
import { useZenithStore } from '@/store/zenithStore'
import type { CelestialObject } from '@/types/celestial'

const CONE_LENGTH = 2_000_000
const CONE_RADIUS = 280_000

const MAX_SAMPLES_PER_TICK = 6

// ── Dot style per category / zenith membership ────────────────────────────────
// Returns raw Cesium Color/number values; called with the Cesium module object
// so it can be used both during entity creation and during delta updates.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPointStyle(Cesium: any, category: string, inZenithWindow: boolean) {
  if (category === 'iss') {
    return {
      color: Cesium.Color.fromCssColorString('#ff6b35'),
      pixelSize: 8,
      outlineColor: Cesium.Color.fromCssColorString('#ff6b35').withAlpha(0.4),
      outlineWidth: 3,
    }
  }
  if (inZenithWindow) {
    return {
      color: Cesium.Color.fromCssColorString('#00d4ff'),
      pixelSize: 6,
      outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
      outlineWidth: 2,
    }
  }
  return {
    color: Cesium.Color.fromCssColorString('#4fc3f7').withAlpha(0.75),
    pixelSize: 3,
    outlineColor: Cesium.Color.fromCssColorString('#4fc3f7').withAlpha(0.3),
    outlineWidth: 1,
  }
}

function injectCesiumCSS() {
  const id = 'cesium-widgets-css'
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = '/_cesium/Widgets/widgets.css'
  document.head.appendChild(link)
}

async function getCesium() {
  injectCesiumCSS()
  const Cesium = await import('cesium')
  return Cesium
}

interface EntityCacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  posProp: any
  inZenithWindow: boolean
  tickCount: number
}

export default function CelestialGlobe() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const unsubs: Array<() => void> = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any = null
    let cancelled = false
    const entityCache = new Map<string, EntityCacheEntry>()

    getCesium().then(async (Cesium) => {
      if (cancelled || !containerRef.current) return

      const { observer } = useZenithStore.getState()

      // ── Viewer init ─────────────────────────────────────────────────────────
      // Set Ion token before creating the viewer so asset 2 resolves correctly.
      const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN
      if (ionToken) Cesium.Ion.defaultAccessToken = ionToken

      try {
        viewer = new Cesium.Viewer(containerRef.current, {
          // baseLayer: false → don't load any default imagery; we add our own below.
          baseLayer: false,
          baseLayerPicker: false,
          animation: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          navigationHelpButton: false,
          navigationInstructionsInitiallyVisible: false,
        })
      } catch (err) {
        console.error('[CelestialGlobe] Cesium viewer init failed:', err)
        return
      }

      if (cancelled) {
        if (!viewer.isDestroyed()) viewer.destroy()
        return
      }

      // Crisp HiDPI rendering.
      viewer.resolutionScale = window.devicePixelRatio ?? 1

      if (process.env.NODE_ENV === 'development') {
        viewer.scene.debugShowFramesPerSecond = true
      }

      // Clock must animate so SampledPositionProperty interpolates in real-time.
      viewer.clock.shouldAnimate = true
      viewer.clock.multiplier = 1.0

      // ── Imagery: Bing photorealistic aerial → fallback NaturalEarth II ──────
      try {
        const bingProvider = await Cesium.IonImageryProvider.fromAssetId(2)
        if (!cancelled) viewer.imageryLayers.addImageryProvider(bingProvider)
      } catch {
        console.warn('[CelestialGlobe] Bing/Ion imagery unavailable, using NaturalEarth II')
        try {
          const fallbackProvider = await Cesium.TileMapServiceImageryProvider.fromUrl(
            Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
          )
          if (!cancelled) viewer.imageryLayers.addImageryProvider(fallbackProvider)
        } catch (err) {
          console.error('[CelestialGlobe] All imagery providers failed:', err)
        }
      }

      if (cancelled || viewer.isDestroyed()) return

      // ── Globe appearance ────────────────────────────────────────────────────
      viewer.scene.globe.show = true
      // Black base so the ocean uses imagery colour rather than Cesium's default blue.
      viewer.scene.globe.baseColor = Cesium.Color.BLACK
      // Lower = sharper imagery (default 2.0).
      viewer.scene.globe.maximumScreenSpaceError = 1.5
      // Keep false so satellite dots aren't clipped by terrain.
      viewer.scene.globe.depthTestAgainstTerrain = false

      // ── Atmosphere & lighting ───────────────────────────────────────────────
      viewer.scene.globe.showGroundAtmosphere = true
      viewer.scene.skyAtmosphere.show = true
      viewer.scene.skyBox.show = true

      // Sun-driven terminator line (day/night split) + atmospheric glow.
      viewer.scene.globe.enableLighting = true
      viewer.scene.sun = new Cesium.Sun()
      viewer.scene.moon = new Cesium.Moon()

      try {
        viewer.scene.globe.dynamicAtmosphereLighting = true
        viewer.scene.globe.dynamicAtmosphereLightingFromSun = true
      } catch {
        // Property may not exist on all build variants.
      }

      // Boost atmosphere scattering intensity (Cesium 1.100+).
      try {
        viewer.scene.globe.atmosphereLightIntensity = 10.0
        viewer.scene.globe.atmosphereRayleighCoefficient = new Cesium.Cartesian3(
          5.5e-6, 13.0e-6, 28.4e-6
        )
      } catch {
        // Silently skip if not available in this build.
      }

      // ── Post-processing ─────────────────────────────────────────────────────
      // FXAA: smooths satellite dot and cone edges at minimal GPU cost.
      try {
        viewer.scene.postProcessStages.fxaa.enabled = true
      } catch {
        // Ignore if post-process pipeline is unavailable.
      }

      // Bloom: makes the atmosphere limb and bright satellites glow.
      try {
        const bloom = viewer.scene.postProcessStages.bloom
        bloom.enabled = true
        bloom.uniforms.glowOnly = false
        bloom.uniforms.contrast = 128
        bloom.uniforms.brightness = -0.3
        bloom.uniforms.delta = 1.0
        bloom.uniforms.sigma = 3.78
        bloom.uniforms.stepSize = 5.0
      } catch {
        // Bloom may not be available in all environments (e.g. no WebGL2).
      }

      // ── Camera ──────────────────────────────────────────────────────────────
      // 22,000 km altitude gives the globe breathing room against black space.
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(80.24, 12.97, 22_000_000),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
      })

      // ── Zenith cone ─────────────────────────────────────────────────────────
      // High-contrast cyan reads against both ocean and land on photorealistic imagery.
      const renderCone = (show: boolean) => {
        viewer.entities.removeById('zenith-cone')
        const apex = Cesium.Cartesian3.fromDegrees(
          observer.longitude,
          observer.latitude,
          observer.altitudeM
        )
        const center = Cesium.Cartesian3.fromDegrees(
          observer.longitude,
          observer.latitude,
          observer.altitudeM + CONE_LENGTH / 2
        )
        const enu = Cesium.Transforms.eastNorthUpToFixedFrame(apex)
        const rotation = Cesium.Matrix4.getMatrix3(enu, new Cesium.Matrix3())
        const orientation = Cesium.Quaternion.fromRotationMatrix(rotation)
        viewer.entities.add({
          id: 'zenith-cone',
          show,
          position: center,
          orientation,
          cylinder: {
            length: CONE_LENGTH,
            topRadius: CONE_RADIUS,
            bottomRadius: 0,
            material: new Cesium.ColorMaterialProperty(
              Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.18)
            ),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.7),
            outlineWidth: 2,
          },
        })
      }

      renderCone(useZenithStore.getState().showZenithCone)

      const unsubCone = useZenithStore.subscribe(
        (s) => s.showZenithCone,
        (show) => {
          const cone = viewer.entities.getById('zenith-cone')
          if (cone) cone.show = show
        }
      )
      unsubs.push(unsubCone)

      // ── Delta satellite entity sync ──────────────────────────────────────────
      // Maintains a Map<id, EntityCacheEntry> mirroring Cesium's entity collection.
      // Each tick: addSample() on existing entities (smooth interpolation via
      // SampledPositionProperty), add new ones, remove stale ones.
      // Never rebuilds the full entity set — avoids the O(n) stutter every 10s.
      const syncEntities = (objects: Map<string, CelestialObject>) => {
        if (!viewer || viewer.isDestroyed()) return

        // Remove entities no longer in the catalogue.
        const cesiumIds: string[] = []
        const vals = viewer.entities.values
        for (let i = 0; i < vals.length; i++) cesiumIds.push(vals[i].id as string)
        for (const id of cesiumIds) {
          if (id === 'zenith-cone') continue
          if (!objects.has(id)) {
            viewer.entities.removeById(id)
            entityCache.delete(id)
          }
        }

        const nowDate = new Date()
        const t0 = Cesium.JulianDate.fromDate(nowDate)

        for (const obj of objects.values()) {
          const pos0 = Cesium.Cartesian3.fromDegrees(
            obj.geo.longitude,
            obj.geo.latitude,
            obj.geo.heightKm * 1000
          )

          if (entityCache.has(obj.id)) {
            // ── Update existing entity ───────────────────────────────────────
            const cache = entityCache.get(obj.id)!
            cache.tickCount++

            // Recycle SampledPositionProperty every N ticks to cap memory usage.
            let posProp = cache.posProp
            if (cache.tickCount % MAX_SAMPLES_PER_TICK === 0) {
              posProp = new Cesium.SampledPositionProperty()
              posProp.setInterpolationOptions({
                interpolationDegree: 1,
                interpolationAlgorithm: Cesium.LinearApproximation,
              })
              posProp.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD
              posProp.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD
              const entity = viewer.entities.getById(obj.id)
              if (entity) entity.position = posProp
              cache.posProp = posProp
            }

            posProp.addSample(t0, pos0)
            if (obj.geoNext) {
              const intervalSec =
                (obj.updatedAt
                  ? new Date(obj.updatedAt + 10_000).getTime() - nowDate.getTime()
                  : 10_000) / 1000
              const t1 = Cesium.JulianDate.addSeconds(t0, intervalSec, new Cesium.JulianDate())
              posProp.addSample(
                t1,
                Cesium.Cartesian3.fromDegrees(
                  obj.geoNext.longitude,
                  obj.geoNext.latitude,
                  obj.geoNext.heightKm * 1000
                )
              )
            }

            // Only mutate Cesium graphics when zenith membership changes.
            if (cache.inZenithWindow !== obj.inZenithWindow) {
              cache.inZenithWindow = obj.inZenithWindow
              const entity = viewer.entities.getById(obj.id)
              if (entity?.point) {
                const style = getPointStyle(Cesium, obj.category, obj.inZenithWindow)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(entity.point.pixelSize as any).setValue(style.pixelSize)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(entity.point.outlineWidth as any).setValue(style.outlineWidth)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(entity.point.color as any).setValue(style.color)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(entity.point.outlineColor as any).setValue(style.outlineColor)
              }
              if (entity?.label) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(entity.label.show as any).setValue(obj.inZenithWindow)
              }
            }
          } else {
            // ── Add new entity ───────────────────────────────────────────────
            const posProp = new Cesium.SampledPositionProperty()
            posProp.setInterpolationOptions({
              interpolationDegree: 1,
              interpolationAlgorithm: Cesium.LinearApproximation,
            })
            posProp.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD
            posProp.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD
            posProp.addSample(t0, pos0)

            if (obj.geoNext) {
              const t1 = Cesium.JulianDate.addSeconds(t0, 10, new Cesium.JulianDate())
              posProp.addSample(
                t1,
                Cesium.Cartesian3.fromDegrees(
                  obj.geoNext.longitude,
                  obj.geoNext.latitude,
                  obj.geoNext.heightKm * 1000
                )
              )
            }

            const style = getPointStyle(Cesium, obj.category, obj.inZenithWindow)
            viewer.entities.add({
              id: obj.id,
              name: obj.name,
              position: posProp,
              point: {
                pixelSize: style.pixelSize,
                color: style.color,
                outlineColor: style.outlineColor,
                outlineWidth: style.outlineWidth,
              },
              label: {
                text: obj.name,
                show: obj.inZenithWindow,
                font: '11px monospace',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -10),
              },
            })

            entityCache.set(obj.id, {
              posProp,
              inZenithWindow: obj.inZenithWindow,
              tickCount: 0,
            })
          }
        }
      }

      syncEntities(useZenithStore.getState().objects)
      const unsubObjects = useZenithStore.subscribe((s) => s.objects, syncEntities)
      unsubs.push(unsubObjects)
    })

    return () => {
      cancelled = true
      unsubs.forEach((u) => u())
      entityCache.clear()
      if (viewer && !viewer.isDestroyed()) viewer.destroy()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ background: '#050510', willChange: 'transform', transform: 'translateZ(0)' }}
    />
  )
}
