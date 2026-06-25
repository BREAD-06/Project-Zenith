'use client'

import { useEffect, useRef } from 'react'
import { useZenithStore } from '@/store/zenithStore'
import type { CelestialObject } from '@/types/celestial'
import { initSolarSystem, HOME_VIEW_LON, HOME_VIEW_LAT, HOME_VIEW_HEIGHT } from '@/lib/solarSystem'

const CONE_LENGTH = 2_000_000
// Half-angle of 15° represents the 75°–90° zenith shell: an object at 75°
// elevation sits 15° off the local vertical. radius = length · tan(15°).
const CONE_RADIUS = Math.round(CONE_LENGTH * Math.tan((15 * Math.PI) / 180))
// ── Orbital trail ring buffer ─────────────────────────────────────────────────
// Max samples kept per trail object for its glow polyline (oldest shifted off).
const TRAIL_LENGTH = 8

// ── 3D tracking models ────────────────────────────────────────────────────────
// The ISS gets its own dedicated model; every other satellite opens one of these
// (chosen deterministically by id, so each satellite keeps a consistent but
// varied look instead of everyone sharing one model). Files live in /public/models.
const SAT_MODEL_URIS = [
  '/models/satellite.glb',
  '/models/satellite1.glb',
  '/models/satellite2.glb',
  '/models/satellite3.glb',
  '/models/satellite4.glb',
  '/models/satellite5.glb',
  '/models/satellite6.glb',
  '/models/satellite7.glb',
]
function pickSatelliteModel(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return SAT_MODEL_URIS[h % SAT_MODEL_URIS.length]
}

// ── Pre-built Color cache ─────────────────────────────────────────────────────
// Populated once after Cesium loads so getPointStyle never parses CSS strings
// in the hot per-entity loop (fromCssColorString is surprisingly expensive at
// 10 000 calls per tick).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let C: Record<string, any> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildColorCache(Cesium: any) {
  if (C) return
  C = {
    // Category fill colours (CLAUDE.md convention).
    satFill: Cesium.Color.fromCssColorString('#4fc3f7'),
    issFill: Cesium.Color.fromCssColorString('#ffcc02'),
    planetFill: Cesium.Color.fromCssColorString('#ff8c69'),
    // Declutter palette — faint cyan for the non-zenith satellite swarm.
    cyan: Cesium.Color.CYAN,
    cyanFaint: Cesium.Color.CYAN.withAlpha(0.2),
    satZenOutline: Cesium.Color.CYAN.withAlpha(0.8),
    issOutline: Cesium.Color.fromCssColorString('#ffcc02').withAlpha(0.6),
    planetOutline: Cesium.Color.fromCssColorString('#ff8c69').withAlpha(0.6),
    // Label offsets: nudge the label off its dot and pull it toward the camera
    // so it never z-fights the point primitive.
    eyeLabel: new Cesium.Cartesian3(0, 0, -10000),
    eyeZero: Cesium.Cartesian3.ZERO,
    labelPixelOffset: new Cesium.Cartesian2(10, -10),
    // Subtle white edge so in-zenith points pop against the globe.
    zenOutline: Cesium.Color.WHITE.withAlpha(0.85),
    // Zenith cone.
    coneBody: Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.15),
    coneOutline: Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.6),
    // Observer marker.
    obsRingBody: Cesium.Color.fromCssColorString('#7c3aed').withAlpha(0.12),
    obsRingOL: Cesium.Color.fromCssColorString('#c4b5fd').withAlpha(0.7),
    obsDotFill: Cesium.Color.fromCssColorString('#c4b5fd'),
    dotOutlineWh: Cesium.Color.WHITE,
    // Labels.
    labelFill: Cesium.Color.WHITE,
    labelOutline: Cesium.Color.BLACK,
  }
}

// Per-category styling. ISS and planets are always full-size + labelled; the
// satellite swarm is decluttered (tiny faint dots) unless it enters the zenith
// window, where it gets a bright, outlined, labelled treatment.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPointStyle(category: string, inZenithWindow: boolean): any {
  if (category === 'iss') {
    return {
      pixelSize: 10,
      color: C!.issFill,
      outlineColor: C!.issOutline,
      outlineWidth: 2,
      showLabel: true,
      labelFont: '11px Space Mono',
      labelFill: C!.issFill,
      eyeOffset: C!.eyeZero,
    }
  }
  if (category === 'planet') {
    return {
      pixelSize: 8,
      color: C!.planetFill,
      outlineColor: C!.planetOutline,
      outlineWidth: 1,
      showLabel: true,
      labelFont: '11px monospace',
      labelFill: C!.planetFill,
      eyeOffset: C!.eyeZero,
    }
  }
  // satellite
  if (inZenithWindow) {
    return {
      pixelSize: 7,
      color: C!.satFill,
      outlineColor: C!.satZenOutline,
      outlineWidth: 1,
      showLabel: true,
      labelFont: '11px Space Mono',
      labelFill: C!.cyan,
      eyeOffset: C!.eyeLabel,
    }
  }
  return {
    pixelSize: 2,
    color: C!.cyanFaint,
    outlineColor: C!.cyanFaint,
    outlineWidth: 0,
    showLabel: false,
    labelFont: '11px Space Mono',
    labelFill: C!.cyan,
    eyeOffset: C!.eyeLabel,
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

export default function CelestialGlobe() {
  const containerRef = useRef<HTMLDivElement>(null)
  // Shared phase for the zenith cone's breathing pulse (driven by CallbackProperty).
  const conePulseRef = useRef<{ phase: number }>({ phase: 0 })

  useEffect(() => {
    if (!containerRef.current) return

    const unsubs: Array<() => void> = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any = null
    let cancelled = false
    // rAF handle so we never queue more than one sync per frame.
    let pendingSyncRaf = 0
    let readyTimeout: any = null
    // ── Positional Animation State ───────────────────────────────────────────
    // Smoothly interpolates satellites to their new positions (lat/lon/alt)
    // over a few frames so they visually glide across the globe.
    let twRaf = 0
    const TW_SPEED = 0.15 // 15% interpolation per frame

    // Batched render primitives (created once after viewer init). One collection
    // each for all points / labels / trails instead of ~750 individual entities.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pointCollection: any = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let labelCollection: any = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let trailCollection: any = null
    // Per-object primitive handles + trail position history.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pointCache = new Map<string, any>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labelCache = new Map<string, any>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trailCache = new Map<string, any>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trailHistory = new Map<string, any[]>()

    getCesium().then(async (Cesium) => {
      if (cancelled || !containerRef.current) return

      buildColorCache(Cesium)

      // ── Viewer ───────────────────────────────────────────────────────────────
      const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN
      if (ionToken) Cesium.Ion.defaultAccessToken = ionToken

      try {
        viewer = new Cesium.Viewer(containerRef.current, {
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
        console.error('[CelestialGlobe] Viewer init failed:', err)
        return
      }

      if (cancelled) { viewer.isDestroyed() || viewer.destroy(); return }

      // Cap at 1.0× to significantly reduce pixel rendering load on high-DPI / 4K displays.
      viewer.resolutionScale = Math.min(window.devicePixelRatio ?? 1, 1.0)

      // Low-power mode: while the landing overlay is up, cap the globe's frame rate
      // so it doesn't contend with the astronaut model-viewer for the GPU. Restored
      // to uncapped once the landing is dismissed.
      const applyGlobePower = (low: boolean) => {
        if (viewer && !viewer.isDestroyed()) viewer.targetFrameRate = low ? 20 : undefined
      }
      applyGlobePower(useZenithStore.getState().globeLowPower)
      unsubs.push(
        useZenithStore.subscribe((s) => s.globeLowPower, applyGlobePower)
      )

      if (process.env.NODE_ENV === 'development') {
        viewer.scene.debugShowFramesPerSecond = true
      }

      // Positions are written manually each 10 s tick, so Cesium's clock never
      // needs to advance — stop it to avoid per-frame property re-evaluation.
      viewer.clock.shouldAnimate = false

      // Render on demand: the scene only redraws when something actually changes
      // (camera move, tile load, or our explicit requestRender after a data tick)
      // instead of running a continuous 60 fps loop.
      viewer.scene.requestRenderMode = true
      viewer.scene.maximumRenderTimeChange = Infinity

      // ── Imagery ──────────────────────────────────────────────────────────────
      try {
        const bingProvider = await Cesium.IonImageryProvider.fromAssetId(2)
        if (!cancelled) viewer.imageryLayers.addImageryProvider(bingProvider)
      } catch {
        console.warn('[CelestialGlobe] Ion unavailable, falling back to NaturalEarth II')
        try {
          const fp = await Cesium.TileMapServiceImageryProvider.fromUrl(
            Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
          )
          if (!cancelled) viewer.imageryLayers.addImageryProvider(fp)
        } catch (err) {
          console.error('[CelestialGlobe] All imagery failed:', err)
        }
      }

      if (cancelled || viewer.isDestroyed()) return

      pointCollection = new Cesium.PointPrimitiveCollection()
      viewer.scene.primitives.add(pointCollection)

      // ── Globe ────────────────────────────────────────────────────────────────
      viewer.scene.globe.show = true
      viewer.scene.globe.baseColor = Cesium.Color.BLACK
      // Increase from 2.0 to 4.0 to reduce the number of terrain/imagery tiles loaded,
      // dramatically improving panning and rotation performance.
      viewer.scene.globe.maximumScreenSpaceError = 4.0
      viewer.scene.globe.depthTestAgainstTerrain = false

      // ── Atmosphere & lighting ─────────────────────────────────────────────────
      viewer.scene.globe.showGroundAtmosphere = true
      viewer.scene.skyAtmosphere.show = true
      viewer.scene.skyBox.show = true
      viewer.scene.globe.enableLighting = true
      viewer.scene.sun = new Cesium.Sun()
      viewer.scene.moon = new Cesium.Moon()

      try {
        viewer.scene.globe.dynamicAtmosphereLighting = true
        viewer.scene.globe.dynamicAtmosphereLightingFromSun = true
      } catch { /* not available on this build */ }

      try {
        viewer.scene.globe.atmosphereLightIntensity = 10.0
        viewer.scene.globe.atmosphereMieScaleHeight = 20000
        viewer.scene.globe.atmosphereRayleighCoefficient = new Cesium.Cartesian3(
          5.5e-6, 13.0e-6, 28.4e-6
        )
      } catch { /* Cesium < 1.100 */ }

      // Distance fog softens the limb and adds depth toward the horizon.
      viewer.scene.fog.enabled = true
      viewer.scene.fog.density = 0.0002

      // ── Post-processing ───────────────────────────────────────────────────────
      // FXAA only — bloom over 10 k glowing dots costs ~15 ms/frame on a mid-range GPU.
      try { viewer.scene.postProcessStages.fxaa.enabled = true } catch { /* ignore */ }
      // Bloom is intentionally disabled for performance.
      try { viewer.scene.postProcessStages.bloom.enabled = false } catch { /* ignore */ }

      // ── Camera intro ───────────────────────────────────────────────────────────
      // Start fully zoomed out so the entire globe is visible with breathing room.
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW_LON, HOME_VIEW_LAT, 30_000_000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      })

      // …then gently settle to the home view (~22 000 km up — still the whole
      // globe in frame, just a touch closer). Small delay so the opening tiles
      // finish loading before the flight.
      const introTimeout = setTimeout(() => {
        if (cancelled || !viewer || viewer.isDestroyed()) return
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            HOME_VIEW_LON, HOME_VIEW_LAT, HOME_VIEW_HEIGHT
          ),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-90),
            roll: 0,
          },
          duration: 3.5,
          easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        })
      }, 500)
      unsubs.push(() => clearTimeout(introTimeout))

      // ── Entity selection ──────────────────────────────────────────────────────
      // Click a tracked object → open its detail panel via the store. Clicking
      // empty space (or a non-object entity like the cone/observer marker)
      // deselects. selectedObjectId is the single source of truth for the panel.
      const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
      clickHandler.setInputAction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (movement: any) => {
          const picked = viewer.scene.pick(movement.position)
          // PointPrimitives/Labels carry our object id directly in `.id` (a
          // string); remaining Entities (cone, observer) expose it as `.id.id`.
          let id: unknown = picked?.id
          if (id && typeof id === 'object') id = (id as { id?: unknown }).id
          const objects = useZenithStore.getState().objects
          useZenithStore
            .getState()
            .setSelectedObjectId(
              typeof id === 'string' && objects.has(id) ? id : null
            )
        },
        Cesium.ScreenSpaceEventType.LEFT_CLICK
      )
      unsubs.push(() => clickHandler.destroy())

      // ── Zenith cone ───────────────────────────────────────────────────────────
      // A CylinderGraphics approximating the 75°–90° shell, apex on the observer's
      // surface point, opening straight up. Positions read fresh from the store.
      const renderZenithCone = () => {
        const obs = useZenithStore.getState().observer
        const showCone = useZenithStore.getState().showZenithCone

        viewer.entities.removeById('zenith-cone')
        const surface = Cesium.Cartesian3.fromDegrees(
          obs.longitude, obs.latitude, obs.altitudeM
        )
        // Cylinder geometry is centred on its position, so lift the centre by half
        // a cone-length to place the apex exactly on the observer's surface point.
        const center = Cesium.Cartesian3.fromDegrees(
          obs.longitude, obs.latitude, obs.altitudeM + CONE_LENGTH / 2
        )
        // Point straight up: heading/pitch/roll all zero aligns the cylinder's +z
        // axis with the local east-north-up "up" (zenith) vector.
        const orientation = Cesium.Transforms.headingPitchRollQuaternion(
          surface, new Cesium.HeadingPitchRoll(0, 0, 0)
        )
        // Breathing pulse on a vivid cyan fill: alpha oscillates ~0.47→0.63 so
        // the cone stays clearly visible against the globe at all times.
        const coneMaterial = new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(() => {
            conePulseRef.current.phase += 0.03
            const alpha = 0.55 + Math.sin(conePulseRef.current.phase) * 0.08
            return Cesium.Color.fromCssColorString('#00FFFF').withAlpha(alpha)
          }, false)
        )

        viewer.entities.add({
          id: 'zenith-cone',
          show: showCone,
          position: center,
          orientation,
          cylinder: {
            length: CONE_LENGTH,
            topRadius: CONE_RADIUS, // wide end — up in the sky
            bottomRadius: 0, // apex — at the observer
            material: coneMaterial,
            outline: true,
            // Fully-opaque, wider edge so the cone reads crisply from any angle.
            outlineColor: Cesium.Color.fromCssColorString('#00FFFF'),
            outlineWidth: 3,
          },
        })
        viewer.scene.requestRender()
      }

      // ── Observer marker ───────────────────────────────────────────────────────
      // Dot + range ring at the observer's surface position.
      const renderObserverMarker = () => {
        const obs = useZenithStore.getState().observer

        viewer.entities.removeById('__observer_dot__')
        viewer.entities.add({
          id: '__observer_dot__',
          position: Cesium.Cartesian3.fromDegrees(obs.longitude, obs.latitude, 2000),
          point: {
            pixelSize: 12,
            color: C!.obsDotFill,
            outlineColor: C!.dotOutlineWh,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })

        viewer.entities.removeById('__observer_ring__')
        viewer.entities.add({
          id: '__observer_ring__',
          position: Cesium.Cartesian3.fromDegrees(obs.longitude, obs.latitude, 1000),
          ellipse: {
            semiMajorAxis: 250000,
            semiMinorAxis: 250000,
            material: C!.obsRingBody,
            outline: true,
            outlineColor: C!.obsRingOL,
            outlineWidth: 2,
          },
        })
        viewer.scene.requestRender()
      }

      renderZenithCone()
      renderObserverMarker()

      // Toggle cone visibility without rebuilding the entity.
      const unsubCone = useZenithStore.subscribe(
        (s) => s.showZenithCone,
        (show) => {
          const cone = viewer.entities.getById('zenith-cone')
          if (cone) cone.show = show
          viewer.scene.requestRender()
        }
      )
      unsubs.push(unsubCone)

      // Rebuild observer-anchored entities (cone + marker) when the observer moves.
      const unsubObserver = useZenithStore.subscribe(
        (s) => s.observer,
        (observer) => {
          renderZenithCone()
          renderObserverMarker()
          // Rotate to centre the new observer WITHOUT zooming: preserve the
          // camera's current altitude (distance from Earth) and just recentre +
          // face straight down. Fires for city search, geolocation, and manual
          // coords (all route through setObserver).
          if (!viewer || viewer.isDestroyed()) return
          const currentHeight = viewer.camera.positionCartographic.height
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
              observer.longitude,
              observer.latitude,
              currentHeight // keep current zoom level — rotate only, no zoom
            ),
            orientation: {
              heading: Cesium.Math.toRadians(0),
              pitch: Cesium.Math.toRadians(-90),
              roll: 0,
            },
            duration: 1.5,
            easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
          })
          viewer.scene.requestRender()
        }
      )
      unsubs.push(unsubObserver)

      // CallbackProperty materials don't self-trigger renders under
      // requestRenderMode, so pump a lightweight 20 fps render request to keep the
      // cone's breathing pulse smooth while the rest stays render-on-demand.
      const pulseInterval = setInterval(() => {
        if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender()
      }, 50)
      unsubs.push(() => clearInterval(pulseInterval))

      // ── Batched render primitives ──────────────────────────────────────────────
      // One PointPrimitiveCollection / LabelCollection / PolylineCollection holds
      // every marker, so the whole catalogue draws in a handful of GPU calls.
      pointCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection())
      labelCollection = viewer.scene.primitives.add(new Cesium.LabelCollection())
      trailCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection())

      // ── Per-object teardown ─────────────────────────────────────────────────────
      const removeTrail = (id: string) => {
        const trail = trailCache.get(id)
        if (trail) { trailCollection.remove(trail); trailCache.delete(id) }
        trailHistory.delete(id)
      }
      const removeObject = (id: string) => {
        const point = pointCache.get(id)
        if (point) { pointCollection.remove(point); pointCache.delete(id) }
        const label = labelCache.get(id)
        if (label) { labelCollection.remove(label); labelCache.delete(id) }
        removeTrail(id)
      }

      // Push the current position into the object's ring buffer (cap TRAIL_LENGTH)
      // and create/update its glow polyline. ISS glows gold, zenith sats cyan.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateTrail = (obj: CelestialObject, position: any) => {
        let hist = trailHistory.get(obj.id)
        if (!hist) { hist = []; trailHistory.set(obj.id, hist) }
        hist.push(position)
        if (hist.length > TRAIL_LENGTH) hist.shift()
        if (hist.length < 2) return // need two points to draw a line

        const positions = hist.slice()
        const existing = trailCache.get(obj.id)
        if (existing) {
          existing.positions = positions
        } else {
          const trail = trailCollection.add({
            positions,
            width: 1.5,
            material: Cesium.Material.fromType('Color', {
              color: obj.category === 'iss'
                ? Cesium.Color.fromCssColorString('#ffcc02').withAlpha(0.4)
                : Cesium.Color.CYAN.withAlpha(0.25),
            }),
          })
          trailCache.set(obj.id, trail)
        }
      }

      // ── Batched marker sync ─────────────────────────────────────────────────────
      // Static positions written once per data tick (no SampledPositionProperty),
      // so Cesium does zero per-frame interpolation. One pass updates points,
      // labels (zenith/ISS/planet only), and trails.
      const syncObjectMarkers = (objects: Map<string, CelestialObject>) => {
        if (!viewer || viewer.isDestroyed()) return

        // Remove primitives for objects that dropped out of the store.
        for (const id of pointCache.keys()) {
          if (!objects.has(id)) removeObject(id)
        }
        for (const [id, pt] of pointCache.entries()) {
          if (!objects.has(id)) {
            pointCollection.remove(pt)
            pointCache.delete(id)
          }
        }

        for (const obj of objects.values()) {
          // Solar-system bodies (Sun / planets / Moon) are drawn as their own 3D
          // model entities by initSolarSystem (the orrery, revealed only when you
          // zoom out). They live in the store purely for selection/search/panel,
          // so never draw them as surface point dots — otherwise a planet appears
          // stuck on Earth. Clear any stray primitive and skip.
          if (obj.solarBody) { removeObject(obj.id); continue }

          const targetPos = Cesium.Cartesian3.fromDegrees(
            obj.geo.longitude, obj.geo.latitude, obj.geo.heightKm * 1000
          )
          const style = getPointStyle(obj.category, obj.inZenithWindow)

          // ── Point ──
          const point = pointCache.get(obj.id)
          if (point) {
            point.targetGeo = obj.geo
            point.color = style.color
            point.pixelSize = style.pixelSize
            point.outlineColor = style.outlineColor
            point.outlineWidth = style.outlineWidth
          } else {
            const p = pointCollection.add({
              id: obj.id,
              position: targetPos,
              color: style.color,
              pixelSize: style.pixelSize,
              outlineColor: style.outlineColor,
              outlineWidth: style.outlineWidth,
            })
            p.currentGeo = { ...obj.geo }
            p.targetGeo = obj.geo
            pointCache.set(obj.id, p)
          }

          // ── Label (zenith / ISS / planet only — ~740 sat labels eliminated) ──
          const needsLabel =
            obj.inZenithWindow || obj.category === 'iss' || obj.category === 'planet'
          if (needsLabel) {
            const fill = obj.category === 'iss' ? C!.issFill
              : obj.category === 'planet' ? C!.planetFill
                : C!.cyan
            const label = labelCache.get(obj.id)
            if (label) {
              label.text = obj.name
              label.fillColor = fill
            } else {
              labelCache.set(obj.id, labelCollection.add({
                id: obj.id,
                position: targetPos,
                text: obj.name,
                font: '11px Space Mono, monospace',
                fillColor: fill,
                outlineColor: C!.labelOutline,
                outlineWidth: 1,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: C!.labelPixelOffset,
                eyeOffset: C!.eyeLabel,
              }))
            }
          } else {
            const label = labelCache.get(obj.id)
            if (label) { labelCollection.remove(label); labelCache.delete(obj.id) }
          }

          // ── Trail (zenith + ISS, never planets) ──
          if ((obj.inZenithWindow || obj.category === 'iss') && obj.category !== 'planet') {
            // Push the true target position into the history so the trail
            // accurately represents the orbit, even if the point is gliding.
            updateTrail(obj, targetPos)
          } else {
            removeTrail(obj.id)
          }
        }

        // Start gliding points to their new targetGeos.
        startPositionalAnimation()
      }

      // ── Positional animation loop ─────────────────────────────────────────
      const startPositionalAnimation = () => {
        if (twRaf) return // already running

        const step = () => {
          let animating = false
          if (viewer.isDestroyed()) return

          for (const [id, point] of pointCache.entries()) {
            const cGeo = point.currentGeo
            const tGeo = point.targetGeo
            if (!cGeo || !tGeo) continue

            const dLat = tGeo.latitude - cGeo.latitude
            let dLon = tGeo.longitude - cGeo.longitude
            while (dLon > 180) dLon -= 360
            while (dLon < -180) dLon += 360
            const dAlt = tGeo.heightKm - cGeo.heightKm

            if (Math.abs(dLat) > 0.001 || Math.abs(dLon) > 0.001 || Math.abs(dAlt) > 0.1) {
              cGeo.latitude += dLat * TW_SPEED
              cGeo.longitude += dLon * TW_SPEED
              cGeo.heightKm += dAlt * TW_SPEED
              animating = true
            } else {
              cGeo.latitude = tGeo.latitude
              cGeo.longitude = tGeo.longitude
              cGeo.heightKm = tGeo.heightKm
            }

            const currentPos = Cesium.Cartesian3.fromDegrees(
              cGeo.longitude, cGeo.latitude, cGeo.heightKm * 1000
            )
            point.position = currentPos

            const label = labelCache.get(id)
            if (label) label.position = currentPos
          }

          viewer.scene.requestRender()

          if (animating) {
            twRaf = requestAnimationFrame(step)
          } else {
            twRaf = 0
          }
        }
        twRaf = requestAnimationFrame(step)
      }

      // Initial sync runs immediately (no RAF — viewer just initialised, nothing to block).
      syncObjectMarkers(useZenithStore.getState().objects)

      // Subsequent updates are deferred to the next animation frame so the
      // Zustand → syncObjectMarkers path never stalls Cesium mid-render.
      const unsubObjects = useZenithStore.subscribe(
        (s) => s.objects,
        (objects) => {
          if (pendingSyncRaf) return // already queued, skip
          pendingSyncRaf = requestAnimationFrame(() => {
            pendingSyncRaf = 0
            syncObjectMarkers(objects)
          })
        }
      )
      unsubs.push(unsubObjects)

      // Selection only opens the detail panel + upgrades the marker to an Entity.
      // The camera is owned exclusively by the tracking subscription below, so
      // selection never touches trackedEntity (otherwise the two would fight when
      // a click sets both selectedObjectId and trackingObjectId in the same frame).
      const unsubSelectedObject = useZenithStore.subscribe(
        (s) => s.selectedObjectId,
        () => {
          syncObjectMarkers(useZenithStore.getState().objects)
        }
      )
      unsubs.push(unsubSelectedObject)

      // ── 3D satellite tracking ──────────────────────────────────────────────────
      // Uses Cesium's native trackedEntity: the camera locks onto the satellite
      // and follows it across ticks, while the user keeps full mouse control to
      // orbit / zoom around it. Escape exits tracking (→ flies back to home view).
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') useZenithStore.getState().setTrackingObjectId(null)
      }
      window.addEventListener('keydown', onKeyDown)
      unsubs.push(() => window.removeEventListener('keydown', onKeyDown))

      // Headlight state — while a satellite is being viewed we light it from the
      // camera so it's bright from any angle; on exit we restore the sun so the
      // globe's normal day/night lighting returns.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let savedSunLight: any = null
      let headlightUpdate: (() => void) | null = null

      // Tear down the tracking model + camera lock. Order matters: clear
      // trackedEntity BEFORE removing the model so Cesium releases the camera
      // transform cleanly — a dangling trackedEntity leaves the camera locked.
      const clearTrackingView = () => {
        if (viewer.isDestroyed()) return
        viewer.trackedEntity = undefined
        // Canonical "stop tracking" release: resets the camera reference frame to
        // world space while preserving its current position (no jump), so a later
        // flyTo / free navigation isn't interpreted in the satellite-locked frame.
        try { viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY) } catch { /* ignore */ }
        viewer.entities.removeById('tracking-satellite-model')
        // Remove the headlight + restore the sun light (globe back to normal).
        if (headlightUpdate) {
          try { viewer.scene.preRender.removeEventListener(headlightUpdate) } catch { /* ignore */ }
          headlightUpdate = null
        }
        if (savedSunLight) { viewer.scene.light = savedSunLight; savedSunLight = null }
      }

      const unsubTracking = useZenithStore.subscribe(
        (s) => s.trackingObjectId,
        (trackingId) => {
          clearTrackingView()

          if (!trackingId || viewer.isDestroyed()) {
            // Restore the previously-tracked satellite's normal marker, then fly
            // back to the opening view of the globe (how it looked on first load).
            syncObjectMarkers(useZenithStore.getState().objects)
            if (!viewer.isDestroyed()) {
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(
                  HOME_VIEW_LON, HOME_VIEW_LAT, HOME_VIEW_HEIGHT
                ),
                orientation: {
                  heading: Cesium.Math.toRadians(0),
                  pitch: Cesium.Math.toRadians(-90),
                  roll: 0,
                },
                duration: 1.5,
                easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
              })
            }
            return
          }

          const objects = useZenithStore.getState().objects
          const obj = objects.get(trackingId)
          if (!obj) return

          // Promote the satellite to an Entity and hide its normal marker (the
          // tracking model replaces it). syncObjectMarkers reads trackingId from
          // the store, so the matched entity's `show` is set false inside it.
          syncObjectMarkers(objects)

          // Build a static position property from the object's current coordinates.
          // The old entity-cache approach was removed in the batched-primitives
          // refactor; the tracked model's position is refreshed each data tick
          // by the syncObjectMarkers pass which writes directly to posProp below.
          const trackPos = Cesium.Cartesian3.fromDegrees(
            obj.geo.longitude, obj.geo.latitude, obj.geo.heightKm * 1000
          )
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const posProp: any = new Cesium.ConstantPositionProperty(trackPos)
          const isISS = obj.category === 'iss'

          // Orient the model to the local east-north-up frame so it sits upright
          // over Earth (panels level, body toward the surface) instead of a random
          // pose — VelocityOrientationProperty produces nothing here because the
          // tracked position is static (zero velocity).
          const trackOrientation = Cesium.Transforms.headingPitchRollQuaternion(
            trackPos, new Cesium.HeadingPitchRoll(0, 0, 0)
          )

          // ISS opens its dedicated model; every other satellite opens one of the
          // satellite GLBs (varied per object) so it's not always the same model.
          const modelUri = isISS ? '/models/iss.glb' : pickSatelliteModel(obj.id)

          // Back view that frames the satellite against the globe: the camera sits
          // on the space (zenith / +up) side and a little to the south, looking
          // down past the model toward Earth — so the satellite is in the
          // foreground with Earth filling the background. The range scales with
          // altitude so low and high orbits alike keep both in frame (a fixed
          // offset put the globe out of view for higher satellites).
          const altM = obj.geo.heightKm * 1000
          const range = Math.max(300_000, Math.min(altM * 0.5, 4_000_000))
          const trackViewFrom = new Cesium.Cartesian3(0, -range * 0.85, range)

          // ── 3D GLB model entity ──────────────────────────────────────────
          const trackedModel = viewer.entities.add({
            id: 'tracking-satellite-model',
            position: posProp,
            orientation: trackOrientation,
            // Initial camera offset (east-north-up) — the back view computed above.
            // The user can still orbit/zoom freely once tracking begins.
            viewFrom: trackViewFrom,
            model: {
              uri: modelUri,
              // Big + always on screen so the model is the clear focus of the view.
              minimumPixelSize: 1000,
              maximumScale: 200000,
              // Extra brightness on top of the headlight below so the model reads
              // clearly (scales the light on THIS model only).
              lightColor: new Cesium.Color(4.0, 4.0, 4.0, 1.0),
              runAnimations: true,
              heightReference: Cesium.HeightReference.NONE,
            },
          })

          // Lock the camera onto the satellite. trackedEntity follows it across
          // ticks and lets the user drag to orbit / scroll to zoom around it.
          viewer.trackedEntity = trackedModel

          // Headlight: light the model from the camera direction so it's fully
          // visible from any angle while viewing (the sun's position no longer
          // matters). Saved + restored in clearTrackingView so the globe's normal
          // sun lighting returns the instant we stop viewing.
          savedSunLight = viewer.scene.light
          const headlight = new Cesium.DirectionalLight({
            direction: Cesium.Cartesian3.clone(
              viewer.camera.directionWC, new Cesium.Cartesian3()
            ),
            intensity: 3.5,
          })
          viewer.scene.light = headlight
          headlightUpdate = () => {
            if (viewer.isDestroyed()) return
            // Keep the light aligned with the camera as the user orbits.
            Cesium.Cartesian3.clone(viewer.camera.directionWC, headlight.direction)
          }
          viewer.scene.preRender.addEventListener(headlightUpdate)
          viewer.scene.requestRender()
        }
      )
      unsubs.push(unsubTracking)
      unsubs.push(clearTrackingView)

      // ── Solar system (built around the untouched Earth) ───────────────────────
      // Adds the Sun + planets + Moon as sibling entities orbiting the fixed Earth.
      // It only reads the viewer/store and adds its own entities — Earth, satellites,
      // the cone, the observer marker, and the camera defaults are all left intact.
      const disposeSolarSystem = initSolarSystem(Cesium, viewer, useZenithStore)
      unsubs.push(disposeSolarSystem)

      // ── Globe-ready signal (drives the Landing overlay's LAUNCH button) ───────
      // Fire once the globe's tiles for the opening view have finished loading, so
      // the landing only reveals a fully-rendered globe. A timeout backstops it.
      let readyFired = false
      const markGlobeReady = () => {
        if (readyFired || cancelled) return
        readyFired = true
        useZenithStore.getState().setGlobeReady(true)
      }
      const onTileProgress = (remaining: number) => {
        if (remaining === 0) {
          viewer.scene.globe.tileLoadProgressEvent.removeEventListener(onTileProgress)
          markGlobeReady()
        }
      }
      viewer.scene.globe.tileLoadProgressEvent.addEventListener(onTileProgress)
      readyTimeout = setTimeout(markGlobeReady, 9000)
    })

    return () => {
      cancelled = true
      if (pendingSyncRaf) { cancelAnimationFrame(pendingSyncRaf); pendingSyncRaf = 0 }
      if (twRaf) { cancelAnimationFrame(twRaf); twRaf = 0 }
      if (readyTimeout) { clearTimeout(readyTimeout); readyTimeout = null }
      useZenithStore.getState().setGlobeReady(false)
      unsubs.forEach((u) => u())
      pointCache.clear()
      labelCache.clear()
      trailCache.clear()
      trailHistory.clear()
      if (viewer && !viewer.isDestroyed()) {
        if (pointCollection) viewer.scene.primitives.remove(pointCollection)
        if (labelCollection) viewer.scene.primitives.remove(labelCollection)
        if (trailCollection) viewer.scene.primitives.remove(trailCollection)
        viewer.destroy()
      }
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
