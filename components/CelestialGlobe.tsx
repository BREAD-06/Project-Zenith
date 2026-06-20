'use client'

import { useEffect, useRef } from 'react'
import { useZenithStore } from '@/store/zenithStore'
import type { CelestialObject } from '@/types/celestial'

const CATEGORY_COLORS: Record<string, string> = {
  satellite: '#4fc3f7',
  iss: '#ffcc02',
  planet: '#ff8c69',
}

const CONE_LENGTH = 2_000_000
const CONE_RADIUS = 280_000

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

  useEffect(() => {
    if (!containerRef.current) return

    const unsubs: Array<() => void> = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any = null
    // Guard the async init against React StrictMode's mount→cleanup→mount cycle:
    // without this, the first cleanup runs before getCesium() resolves (viewer
    // still null), so that viewer is never destroyed and two viewers stack.
    let cancelled = false

    getCesium().then((Cesium) => {
      if (cancelled || !containerRef.current) return

      const { observer } = useZenithStore.getState()

      try {
        viewer = new Cesium.Viewer(containerRef.current, {
          // Offline NaturalEarth II imagery that ships with Cesium — no Ion
          // token required, so the globe renders even without a token.
          baseLayer: Cesium.ImageryLayer.fromProviderAsync(
            Cesium.TileMapServiceImageryProvider.fromUrl(
              Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
            )
          ),
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

        viewer.scene.globe.show = true

        // Look straight down at India from high altitude so Earth fills view.
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(80.2437, 12.9716, 20_000_000),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-90),
            roll: 0,
          },
        })
      } catch (err) {
        console.error('[CelestialGlobe] Cesium viewer init failed:', err)
        return
      }

      // Zenith cone — translucent radar cone with its apex at the observer,
      // widening upward along the local zenith (up) vector.
      const renderCone = (show: boolean) => {
        viewer.entities.removeById('zenith-cone')

        const apex = Cesium.Cartesian3.fromDegrees(
          observer.longitude,
          observer.latitude,
          observer.altitudeM
        )
        // Cylinder geometry is centred on its position, so place the centre half
        // a cone-length above the observer to put the apex exactly at the ground.
        const center = Cesium.Cartesian3.fromDegrees(
          observer.longitude,
          observer.latitude,
          observer.altitudeM + CONE_LENGTH / 2
        )
        // Local east-north-up frame → orientation quaternion so the cylinder's
        // +z axis aligns with the local up (zenith) direction.
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
            topRadius: CONE_RADIUS, // base — widest at the top
            bottomRadius: 0, // apex — at the observer
            material: Cesium.Color.fromCssColorString("#7c3aed").withAlpha(0.25),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#c4b5fd").withAlpha(0.9),
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

      // Sync store objects → Cesium point entities
      const syncEntities = (objects: Map<string, CelestialObject>) => {
        // Remove all object entities, keep the cone
        const toRemove: string[] = []
        const vals = viewer.entities.values
        for (let i = 0; i < vals.length; i++) {
          if (vals[i].id !== 'zenith-cone') toRemove.push(vals[i].id as string)
        }
        toRemove.forEach((id) => viewer.entities.removeById(id))

        for (const obj of objects.values()) {
          const color = Cesium.Color.fromCssColorString(
            CATEGORY_COLORS[obj.category] ?? '#ffffff'
          )
          viewer.entities.add({
            id: obj.id,
            name: obj.name,
            position: Cesium.Cartesian3.fromDegrees(
              obj.geo.longitude,
              obj.geo.latitude,
              obj.geo.heightKm * 1000
            ),
            point: {
              pixelSize: obj.inZenithWindow ? 8 : 4,
              color,
              outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
              outlineWidth: obj.inZenithWindow ? 1 : 0,
            },
            label: obj.inZenithWindow
              ? {
                  text: obj.name,
                  font: '11px monospace',
                  fillColor: Cesium.Color.WHITE,
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 2,
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                  pixelOffset: new Cesium.Cartesian2(0, -10),
                }
              : undefined,
          })
        }
      }

      syncEntities(useZenithStore.getState().objects)
      const unsubObjects = useZenithStore.subscribe((s) => s.objects, syncEntities)
      unsubs.push(unsubObjects)
    })

    return () => {
      cancelled = true
      unsubs.forEach((u) => u())
      if (viewer && !viewer.isDestroyed()) viewer.destroy()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ background: '#050510' }}
    />
  )
}
