'use client'

import dynamic from 'next/dynamic'

const CelestialGlobe = dynamic(() => import('@/components/CelestialGlobe'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-[#050510]">
      <span className="text-sky-400/60 text-sm font-mono animate-pulse">
        Initialising Cesium…
      </span>
    </div>
  ),
})

export default function GlobeWrapper() {
  return <CelestialGlobe />
}
