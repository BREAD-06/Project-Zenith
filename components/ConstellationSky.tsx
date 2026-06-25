'use client'

import { useEffect, useRef } from 'react'
import type { Cartesian3 } from 'cesium'
import { CONSTELLATIONS, type ConstellationData } from '@/lib/constellationData'
import { raDecToCartesian, CELESTIAL_RADIUS_M } from '@/lib/constellationUtils'

/**
 * Self-contained CesiumJS viewer for the /constellations route (Parts 3–5).
 *
 * Its OWN Cesium.Viewer — completely isolated from the main globe (CelestialGlobe),
 * so the main page's frame rate is never affected. It shows the Earth globe with
 * the 20 catalogued constellations on a giant celestial sphere around it (stars in
 * a PointPrimitiveCollection, stick figures in a PolylineCollection, names as
 * entities).
 *
 * Two display modes:
 *  - Default (nothing selected): the overhead/nearest constellation is highlighted
 *    cyan over the Earth view (Part 4).
 *  - Immersive (a constellation selected): camera flies to face it, its lines/stars
 *    light up, every other line fades right back, and a 2000-point starfield is
 *    added for depth (Part 5). Clearing flies home and tears the starfield down.
 *
 * Cesium is imported dynamically inside the effect (never at module top level) so
 * SSR never touches `window`, matching CelestialGlobe's convention.
 */

interface ConstellationSkyProps {
  latitude: number
  longitude: number
  /** Default highlight (overhead ?? nearest) id, from the page. */
  defaultHighlightId: string | null
  /** User-selected constellation id (drives immersive mode), or null. */
  selectedId: string | null
  onSelectConstellation: (id: string | null) => void
}

interface SkyControls {
  applyStyles: (selectedId: string | null, defaultHighlightId: string | null) => void
  flyToConstellation: (c: ConstellationData) => void
  flyHome: () => void
  showStarfield: () => void
  hideStarfield: () => void
}

/**
 * Inject Cesium's widget stylesheet. Without it the `.cesium-widget` and its canvas
 * don't get `position:absolute; width/height:100%`, so the canvas stays at its
 * default 300×150 and the camera frustum uses the wrong aspect ratio — which throws
 * off all framing. Mirrors CelestialGlobe's injectCesiumCSS.
 */
function injectCesiumCSS() {
  const id = 'cesium-widgets-css'
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = '/_cesium/Widgets/widgets.css'
  document.head.appendChild(link)
}

export default function ConstellationSky({
  latitude,
  longitude,
  defaultHighlightId,
  selectedId,
  onSelectConstellation,
}: ConstellationSkyProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Latest onSelect callback, so the click handler (bound once) never goes stale.
  const onSelectRef = useRef(onSelectConstellation)
  onSelectRef.current = onSelectConstellation
  // Latest observer location, read by flyHome / coord effect without rebuilding.
  const homeRef = useRef({ latitude, longitude })
  homeRef.current = { latitude, longitude }
  // Latest selection + default highlight, so the async build applies fresh values
  // even if they changed (e.g. geolocation resolved) while Cesium was loading.
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const defaultHighlightIdRef = useRef(defaultHighlightId)
  defaultHighlightIdRef.current = defaultHighlightId

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null)
  // Imperative controls, populated once the async scene build completes.
  const controlsRef = useRef<SkyControls | null>(null)

  // Build the viewer ONCE. The constellations are fixed on the celestial sphere, so
  // an observer-location change never needs a rebuild — only the highlight + camera
  // recentre, handled by the lighter effects below.
  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false
    injectCesiumCSS()

    import('cesium').then(async (Cesium) => {
      if (cancelled || !containerRef.current) return

      const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN
      if (ionToken) Cesium.Ion.defaultAccessToken = ionToken

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let viewer: any
      try {
        // NOTE: the spec's `imageryProvider: new IonImageryProvider({assetId:2})`
        // constructor + Viewer option were both removed in modern Cesium (1.129
        // here). Same intent via `baseLayer:false` + the async fromAssetId factory,
        // with a NaturalEarth fallback — matching CelestialGlobe.
        viewer = new Cesium.Viewer(containerRef.current, {
          baseLayer: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
        })
      } catch (err) {
        console.error('[ConstellationSky] Viewer init failed:', err)
        return
      }
      if (cancelled) { viewer.isDestroyed() || viewer.destroy(); return }
      viewerRef.current = viewer

      const scene = viewer.scene
      viewer.resolutionScale = Math.min(window.devicePixelRatio ?? 1, 1.0)
      // Render-on-demand for perf (spec).
      scene.requestRenderMode = true
      scene.maximumRenderTimeChange = Infinity
      viewer.clock.shouldAnimate = false
      try { scene.postProcessStages.fxaa.enabled = true } catch { /* ignore */ }
      // Disable Cesium's built-in star skybox so it doesn't clash with our own
      // constellation stars; keep the scene background near-black.
      scene.skyBox.show = false
      scene.backgroundColor = Cesium.Color.fromCssColorString('#03030c')
      scene.globe.baseColor = Cesium.Color.BLACK

      // Earth imagery (Ion Bing → NaturalEarth fallback).
      try {
        const bing = await Cesium.IonImageryProvider.fromAssetId(2)
        if (!cancelled) viewer.imageryLayers.addImageryProvider(bing)
      } catch {
        try {
          const fp = await Cesium.TileMapServiceImageryProvider.fromUrl(
            Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
          )
          if (!cancelled) viewer.imageryLayers.addImageryProvider(fp)
        } catch (err) {
          console.error('[ConstellationSky] All imagery failed:', err)
        }
      }
      if (cancelled || viewer.isDestroyed()) return

      // Wide opening view over the observer (spec).
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          homeRef.current.longitude, homeRef.current.latitude, 25_000_000,
        ),
        duration: 0,
      })

      // ── Colours ──────────────────────────────────────────────────────────────
      const COL = {
        starNormal: Cesium.Color.WHITE.withAlpha(0.6),
        starHi: Cesium.Color.WHITE.withAlpha(0.9),
        starBright: Cesium.Color.fromCssColorString('#fffbe6'),
        lineNormal: Cesium.Color.WHITE.withAlpha(0.15),
        lineHi: Cesium.Color.fromCssColorString('#4fc3f7').withAlpha(0.6), // default-mode highlight
        lineSelected: Cesium.Color.fromCssColorString('#4fc3f7').withAlpha(0.9), // immersive
        lineFaded: Cesium.Color.WHITE.withAlpha(0.05), // immersive non-selected
        labelHi: Cesium.Color.CYAN,
        labelNormal: Cesium.Color.WHITE.withAlpha(0.4),
        labelOutline: Cesium.Color.BLACK,
      }

      // ── Collections ──────────────────────────────────────────────────────────
      const points = scene.primitives.add(new Cesium.PointPrimitiveCollection())
      const polylines = scene.primitives.add(new Cesium.PolylineCollection())
      const labels = scene.primitives.add(new Cesium.LabelCollection())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let starfield: any = null
      const entityIds: string[] = []

      interface StarHandle {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prim: any
        magnitude: number
      }
      interface Handles {
        stars: StarHandle[]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lines: any[]
      }
      const handles = new Map<string, Handles>()

      for (const c of CONSTELLATIONS) {
        const starCart = new Map<string, Cartesian3>()
        const stars: StarHandle[] = []
        for (const star of c.stars) {
          const pos = raDecToCartesian(Cesium, star.ra, star.dec)
          starCart.set(star.id, pos)
          stars.push({
            prim: points.add({
              // Part 8 id scheme: const-star-${constellationId}-${starId}.
              id: `const-star-${c.id}-${star.id}`,
              position: pos,
              pixelSize: 3,
              color: COL.starNormal,
              // Never let the Earth globe occlude the backdrop stars.
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }),
            magnitude: star.magnitude,
          })

          // Bright named stars (mag < 2.0) get a permanent name label (Part 4).
          // Shares the star's const-star id so clicking the label selects too.
          if (star.magnitude < 2.0) {
            labels.add({
              id: `const-star-${c.id}-${star.id}`,
              position: pos,
              text: star.name,
              font: '11px "Space Mono", monospace',
              fillColor: COL.starBright,
              outlineColor: COL.labelOutline,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(8, 0),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            })
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lines: any[] = []
        for (const [aId, bId] of c.lines) {
          const a = starCart.get(aId)
          const b = starCart.get(bId)
          if (!a || !b) continue // guard against a typo'd line id
          lines.push(polylines.add({
            // Same const-star prefix so a line click resolves to its constellation.
            id: `const-star-${c.id}-line`,
            positions: [a, b],
            width: 1,
            material: Cesium.Material.fromType('Color', { color: COL.lineNormal }),
          }))
        }

        // Constellation name label as an entity (spec: id = const-label-${id}).
        const labelId = `const-label-${c.id}`
        viewer.entities.add({
          id: labelId,
          position: raDecToCartesian(Cesium, c.centerRa, c.centerDec),
          label: {
            text: c.name,
            font: '13px Space Mono, monospace',
            fillColor: COL.labelNormal,
            outlineColor: COL.labelOutline,
            outlineWidth: 2,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
        entityIds.push(labelId)
        handles.set(c.id, { stars, lines })
      }

      // ── Styling (default + immersive) ────────────────────────────────────────
      const applyStyles = (selId: string | null, defId: string | null) => {
        if (viewer.isDestroyed()) return
        const immersive = !!selId
        for (const [cid, h] of handles) {
          const sel = cid === selId
          const hi = !immersive && cid === defId

          for (const s of h.stars) {
            if (immersive && sel) {
              // Selected constellation in immersive mode (Part 5b).
              s.prim.pixelSize = 7
              s.prim.color = COL.starBright
            } else if (s.magnitude < 2.0) {
              // Bright named stars keep their distinct treatment otherwise.
              s.prim.pixelSize = 6
              s.prim.color = COL.starBright
            } else if (hi) {
              s.prim.pixelSize = 5
              s.prim.color = COL.starHi
            } else {
              s.prim.pixelSize = 3
              s.prim.color = COL.starNormal
            }
          }

          for (const ln of h.lines) {
            if (immersive) {
              ln.width = sel ? 3 : 1
              ln.material = Cesium.Material.fromType('Color', {
                color: sel ? COL.lineSelected : COL.lineFaded,
              })
            } else {
              ln.width = hi ? 2 : 1
              ln.material = Cesium.Material.fromType('Color', {
                color: hi ? COL.lineHi : COL.lineNormal,
              })
            }
          }

          const labelEntity = viewer.entities.getById(`const-label-${cid}`)
          if (labelEntity) {
            labelEntity.label.fillColor = (immersive ? sel : hi) ? COL.labelHi : COL.labelNormal
          }
        }
        scene.requestRender()
      }

      // ── Camera: immersive fly-in toward a constellation (Part 5a) ─────────────
      const flyToConstellation = (c: ConstellationData) => {
        const center = raDecToCartesian(Cesium, c.centerRa, c.centerDec, 4_000_000_000)
        const direction = Cesium.Cartesian3.normalize(center, new Cesium.Cartesian3())
        // Spec uses a fixed up = (0,0,1); guard against it being parallel to the
        // view direction for near-polar constellations (e.g. Ursa Minor).
        let up = new Cesium.Cartesian3(0, 0, 1)
        if (Math.abs(Cesium.Cartesian3.dot(direction, up)) > 0.99) {
          up = new Cesium.Cartesian3(1, 0, 0)
        }
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.multiplyByScalar(center, 0.0001, new Cesium.Cartesian3()),
          orientation: { direction, up },
          duration: 2.0,
          // Spec wrote CUBIC_IN_OUT_EASING; the actual Cesium member is CUBIC_IN_OUT.
          easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        })
        scene.requestRender()
      }

      const flyHome = () => {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            homeRef.current.longitude, homeRef.current.latitude, 25_000_000,
          ),
          duration: 1.5,
        })
        scene.requestRender()
      }

      // ── Starfield (Part 5c): 2000 random faint points across the sphere ──────
      const showStarfield = () => {
        if (viewer.isDestroyed()) return
        // Immersive view sits inside the atmosphere; switch it off so the dark sky
        // (and the faint starfield) reads instead of a blue scattering wash.
        scene.skyAtmosphere.show = false
        scene.globe.showGroundAtmosphere = false
        if (starfield) return
        const sf = scene.primitives.add(new Cesium.PointPrimitiveCollection())
        const white03 = Cesium.Color.WHITE.withAlpha(0.3)
        for (let i = 0; i < 2000; i++) {
          // Uniform direction on the unit sphere, then push out near the star shell.
          const z = Math.random() * 2 - 1
          const theta = Math.random() * Math.PI * 2
          const r = Math.sqrt(1 - z * z)
          const pos = new Cesium.Cartesian3(
            r * Math.cos(theta) * CELESTIAL_RADIUS_M * 0.96,
            r * Math.sin(theta) * CELESTIAL_RADIUS_M * 0.96,
            z * CELESTIAL_RADIUS_M * 0.96,
          )
          sf.add({
            position: pos,
            pixelSize: 1,
            color: white03,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          })
        }
        starfield = sf
        scene.requestRender()
      }
      const hideStarfield = () => {
        if (viewer.isDestroyed()) return
        if (starfield) scene.primitives.remove(starfield)
        starfield = null
        // Restore the Earth-view atmosphere.
        scene.skyAtmosphere.show = true
        scene.globe.showGroundAtmosphere = true
        scene.requestRender()
      }

      controlsRef.current = { applyStyles, flyToConstellation, flyHome, showStarfield, hideStarfield }

      // ── Picking (Part 8) ─────────────────────────────────────────────────────
      // Star primitives + their labels/lines carry `const-star-${cid}-…`; the
      // constellation-name entity carries `const-label-${cid}`. NB: the spec's
      // split('-')[2] breaks on hyphenated ids (e.g. ursa-major), so we resolve the
      // constellation id by matching the known list by prefix instead.
      const resolveStarConstellation = (raw: string): string | null => {
        const remainder = raw.slice('const-star-'.length)
        const c = CONSTELLATIONS.find(
          (x) => remainder === x.id || remainder.startsWith(`${x.id}-`),
        )
        return c ? c.id : null
      }
      const clickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas)
      clickHandler.setInputAction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (click: any) => {
          const picked = scene.pick(click.position)
          if (!picked) return // background click — keep current selection (spec)

          // Star primitive / star label / line (string id).
          if (typeof picked.id === 'string' && picked.id.startsWith('const-star-')) {
            const cid = resolveStarConstellation(picked.id)
            if (cid) onSelectRef.current(cid)
            return
          }
          // Constellation-name label entity (id.id).
          const entityId = picked.id?.id
          if (typeof entityId === 'string' && entityId.startsWith('const-label-')) {
            onSelectRef.current(entityId.replace('const-label-', ''))
          }
        },
        Cesium.ScreenSpaceEventType.LEFT_CLICK,
      )

      // Apply the freshest state (props may have changed during the async build).
      const sel0 = selectedIdRef.current
      applyStyles(sel0, defaultHighlightIdRef.current)
      if (sel0) {
        showStarfield()
        const c = CONSTELLATIONS.find((x) => x.id === sel0)
        if (c) flyToConstellation(c)
      }

      cleanupRef.current = () => {
        clickHandler.destroy()
        if (!viewer.isDestroyed()) {
          for (const eid of entityIds) viewer.entities.removeById(eid)
          scene.primitives.remove(points)
          scene.primitives.remove(polylines)
          scene.primitives.remove(labels)
          if (starfield) scene.primitives.remove(starfield)
        }
        starfield = null
        controlsRef.current = null
      }
    })

    const cleanupRef = { current: null as null | (() => void) }

    return () => {
      cancelled = true
      cleanupRef.current?.()
      const v = viewerRef.current
      if (v && !v.isDestroyed()) v.destroy()
      viewerRef.current = null
    }
    // Build once on mount; never rebuild (see effects below for live updates).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Restyle the sky whenever the selection or the default (zenith) highlight
  // changes — no camera movement, so geolocation updates recolour smoothly.
  useEffect(() => {
    controlsRef.current?.applyStyles(selectedId, defaultHighlightId)
  }, [selectedId, defaultHighlightId])

  // Move the camera on SELECTION changes only: fly into a picked constellation
  // (with starfield), or fly back to the observer's home view when cleared.
  useEffect(() => {
    const ctl = controlsRef.current
    if (!ctl) return
    if (selectedId) {
      ctl.showStarfield()
      const c = CONSTELLATIONS.find((x) => x.id === selectedId)
      if (c) ctl.flyToConstellation(c)
    } else {
      ctl.hideStarfield()
      ctl.flyHome()
    }
  }, [selectedId])

  // When the observer location updates (e.g. geolocation resolves) and nothing is
  // selected, recentre the home view on the new location.
  useEffect(() => {
    if (!selectedId) controlsRef.current?.flyHome()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude])

  return (
    <div
      ref={containerRef}
      className="fixed inset-0"
      style={{ background: '#03030c', willChange: 'transform', transform: 'translateZ(0)' }}
    />
  )
}
