'use client'

import { Suspense } from 'react'
import ConstellationViewer from '@/components/ConstellationViewer'

// Standalone constellation explorer. Entirely self-contained: its own CesiumJS
// viewer instance — ConstellationViewer dynamically imports ConstellationSky with
// `dynamic(() => …, { ssr: false })`, so Cesium never runs on the server. Reached
// from the globe's TopBar; the observer location arrives via ?lat=&lng= search
// params, so this route shares no Zustand state with the main globe.
//
// useSearchParams (inside ConstellationViewer) needs a Suspense boundary, so it's
// provided here.
export default function ConstellationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center bg-[#03030c]">
          <span className="text-sky-400/60 text-sm font-mono animate-pulse">
            Mapping the night sky…
          </span>
        </div>
      }
    >
      <ConstellationViewer />
    </Suspense>
  )
}
