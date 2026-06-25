'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { rankConstellationsByZenithDistance } from '@/lib/constellationUtils'
import { getConstellationById } from '@/lib/constellationData'
import { useZenithStore } from '@/store/zenithStore'
import ConstellationPanel from '@/components/ConstellationPanel'
import ConstellationSidebar from '@/components/ConstellationSidebar'

// The Cesium star map mounts client-only (ssr:false) — same convention as the
// main globe's GlobeWrapper, so SSR never pulls Cesium into the server bundle.
const ConstellationSky = dynamic(() => import('@/components/ConstellationSky'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex items-center justify-center bg-[#03030c]">
      <span className="text-sky-400/60 text-sm font-mono animate-pulse">
        Mapping the night sky…
      </span>
    </div>
  ),
})

// Chennai default (matches the store's default observer) when no params are passed.
const DEFAULT_LAT = 12.9716
const DEFAULT_LNG = 80.2437

function parseCoord(value: string | null, fallback: number): number {
  const n = value === null ? NaN : Number(value)
  return Number.isFinite(n) ? n : fallback
}

type CoordSource = 'url' | 'geo'

export default function ConstellationViewer() {
  const params = useSearchParams()

  // Observer coordinates: seeded from the URL (or Chennai), then upgraded to the
  // browser's real geolocation once the user grants permission. The constellation
  // nearest the zenith is derived from these — so granting location pinpoints the
  // constellation that's actually 90° overhead where you are.
  const [coords, setCoords] = useState(() => ({
    lat: parseCoord(params.get('lat'), DEFAULT_LAT),
    lng: parseCoord(params.get('lng'), DEFAULT_LNG),
    source: 'url' as CoordSource,
  }))
  const [locating, setLocating] = useState(true)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocating(false)
      return
    }
    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'geo' })
        setLocating(false)
      },
      () => { if (!cancelled) setLocating(false) }, // denied / unavailable → keep URL coords
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600_000 },
    )
    return () => { cancelled = true }
  }, [])

  // Pause the globe's simulation loops while the constellation viewer is active.
  // The worker stays alive with its parsed TLEs in memory (sleep mode), so
  // resuming on unmount is instant — no re-parsing 10k satellites.
  useEffect(() => {
    useZenithStore.getState().setSimulationActive(false)
    return () => useZenithStore.getState().setSimulationActive(true)
  }, [])

  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Rank every constellation by distance to the zenith for THIS observer; nearest
  // first. The head of the list is the constellation closest to 90° overhead.
  const ranked = useMemo(
    () => rankConstellationsByZenithDistance(coords.lat, coords.lng),
    [coords.lat, coords.lng],
  )
  const zenith = ranked[0]
  const zenithId = zenith?.constellation.id ?? null
  // "Overhead" = within 20° of straight up; otherwise it's merely the nearest.
  const overheadId = zenith && zenith.zenithDistance < 20 ? zenith.constellation.id : null

  // Load/locate toast: re-shows (and re-times) whenever the observer location
  // changes, so granting geolocation surfaces the new zenith constellation.
  const [showToast, setShowToast] = useState(true)
  useEffect(() => {
    setShowToast(true)
    const t = setTimeout(() => setShowToast(false), 4000)
    return () => clearTimeout(t)
  }, [zenithId, coords.source])

  const selected = (selectedId ? getConstellationById(selectedId) : null) ?? null
  // The constellation highlighted by default in the sky: the one at the zenith.
  const defaultHighlightId = zenithId
  // Status badge for the panel: is the selected one overhead, or merely nearest?
  const selectedStatus: 'overhead' | 'nearest' | null = !selected
    ? null
    : overheadId === selected.id
      ? 'overhead'
      : zenithId === selected.id
        ? 'nearest'
        : null

  const hemisphereLat = `${Math.abs(coords.lat).toFixed(2)}°${coords.lat >= 0 ? 'N' : 'S'}`
  const hemisphereLng = `${Math.abs(coords.lng).toFixed(2)}°${coords.lng >= 0 ? 'E' : 'W'}`
  const toastText = locating
    ? 'Locating you…'
    : zenith
      ? `${overheadId ? 'Overhead' : 'Nearest your zenith'}: ${zenith.constellation.name}`
      : ''

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#03030c] text-white">
      <ConstellationSky
        latitude={coords.lat}
        longitude={coords.lng}
        defaultHighlightId={defaultHighlightId}
        selectedId={selectedId}
        onSelectConstellation={setSelectedId}
      />

      {/* ── Top-left: back to the main globe (carries observer) ─────────────── */}
      <Link href={`/explore?lat=${coords.lat}&lng=${coords.lng}`}>
        <button
          className="fixed top-4 left-4 z-50 flex items-center gap-2 bg-black/50 backdrop-blur-md border border-cyan-500/20 text-cyan-300 text-xs font-mono px-4 py-2 rounded-full hover:bg-cyan-500/10 transition-all"
        >
          ← Back to Zenith
        </button>
      </Link>

      {/* ── Top-center: page title ──────────────────────────────────────────── */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 text-cyan-400 text-xs font-mono tracking-widest pointer-events-none">
        ✦ CONSTELLATION VIEWER
      </div>

      {/* ── Observer info (under the title; sidebar owns the top-right) ──────── */}
      <div className="fixed top-9 left-1/2 -translate-x-1/2 z-40 text-[11px] text-slate-400 font-mono pointer-events-none hidden sm:block whitespace-nowrap">
        {locating
          ? 'Locating you…'
          : `${coords.source === 'geo' ? '📍 Your location' : 'Observing from'}: ${hemisphereLat}, ${hemisphereLng}`}
      </div>

      {/* ── Right: constellation side menu ──────────────────────────────────── */}
      <ConstellationSidebar
        ranked={ranked}
        zenithId={zenithId}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
      />

      {/* ── Bottom-center: load toast (fades after 4s) ──────────────────────── */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-black/60 backdrop-blur-sm text-cyan-300 text-xs font-mono px-4 py-2 rounded-full border border-cyan-500/20 transition-opacity duration-700 pointer-events-none ${
          showToast && toastText ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {toastText}
      </div>

      {/* ── Selected-constellation detail panel (Part 6) ───────────────────── */}
      <ConstellationPanel
        constellation={selected}
        status={selectedStatus}
        onClose={() => setSelectedId(null)}
      />
    </main>
  )
}
