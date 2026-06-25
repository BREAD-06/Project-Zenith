'use client'

import { useEffect, useState } from 'react'
import TopBar from '@/components/TopBar'
import ZenithWindow from '@/components/ZenithWindow'
import DevSeedButton from '@/components/DevSeedButton'
import GlobeWrapper from '@/components/GlobeWrapper'
import RadarOverlay from '@/components/RadarOverlay'
import ObjectDetailPanel from '@/components/ObjectDetailPanel'
import { startRefreshLoop } from '@/lib/refreshLoop'
import { useZenithStore } from '@/store/zenithStore'

/**
 * The Zenith globe application. Rendered directly at /explore, and also mounted
 * behind the Landing overlay at / so it fully initialises while the landing is
 * shown (the landing reveals it once `globeReady` flips true).
 */
export default function ZenithApp() {
  const [showDev, setShowDev] = useState(false)

  // Disclaimer stays visible until satellites are actually rendered on the globe.
  const satellitesLoaded = useZenithStore(
    (s) => s.objects.size > 0 && !s.dataLoading
  )
  // Once satellites load, keep it dismissed forever (even if dataLoading flips
  // true again on a later refresh tick).
  const [dismissedDisclaimer, setDismissedDisclaimer] = useState(false)
  useEffect(() => {
    if (satellitesLoaded && !dismissedDisclaimer) setDismissedDisclaimer(true)
  }, [satellitesLoaded, dismissedDisclaimer])
  const showDisclaimer = !dismissedDisclaimer

  // Real-time data pipeline: starts on mount, cleans up on unmount.
  useEffect(() => {
    const stopRefreshLoop = startRefreshLoop(useZenithStore)
    return stopRefreshLoop
  }, [])

  // DevSeedButton is no longer auto-shown — opt in with ?dev=true.
  useEffect(() => {
    setShowDev(new URLSearchParams(window.location.search).get('dev') === 'true')
  }, [])

  // h-[100dvh] (dynamic viewport height) so mobile browser chrome doesn't crop the bottom.
  return (
    <main className="flex flex-col h-[100dvh] bg-[#050510] overflow-hidden">
      <TopBar />
      <div className="relative flex-1 overflow-hidden">
        <GlobeWrapper />
        {/* UI overlay layer — fades/scales in on load. pointer-events-none so the
            globe stays interactive through the gaps; interactive panels re-enable
            their own pointer events. ObjectDetailPanel is kept outside because it's
            position:fixed and must not inherit this layer's transform. */}
        <div className="absolute inset-0 pointer-events-none cosmic-fade-in">
          <RadarOverlay />
          <ZenithWindow />
          {showDev && <DevSeedButton />}
        </div>
        <ObjectDetailPanel />

        {/* Rendering disclaimer — fades in, auto-dismisses after 8 s */}
        {showDisclaimer && (
          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-pulse"
            style={{ animation: 'fadeInUp 0.6s ease-out' }}
          >
            <p className="bg-slate-900/80 backdrop-blur-sm border border-slate-700/50 rounded-full px-5 py-2 text-xs text-slate-400 font-mono whitespace-nowrap shadow-lg">
              ⏳ Globe rendering may take a few seconds — please wait
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
