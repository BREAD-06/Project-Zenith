'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useZenithStore } from '@/store/zenithStore'
import ObserverPicker from '@/components/ObserverPicker'
import ObjectSearch from '@/components/ObjectSearch'

export default function TopBar() {
  const [pickerOpen, setPickerOpen] = useState(false)
  const observer = useZenithStore((s) => s.observer)
  const zenithCount = useZenithStore((s) => s.zenithObjects.length)
  const trackedCount = useZenithStore((s) => s.objects.size)
  // maxAltitude is computed once per pipeline tick inside upsertObjects —
  // no O(n) work here in the render path.
  const maxAltitude = useZenithStore((s) => s.maxAltitude)
  const dataLoading = useZenithStore((s) => s.dataLoading)
  const lastError = useZenithStore((s) => s.lastError)

  return (
    <>
    <div
      className="relative flex items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-gradient-to-b from-[#0a0a18]/80 to-black/20 backdrop-blur-xl text-white shrink-0 z-10 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-cyan-400/40 after:to-transparent"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-cyan-300 via-sky-300 to-violet-300 bg-clip-text text-transparent">
          ✦ Zenith
        </span>
        <span className="text-slate-600 hidden lg:inline">/</span>
        <span className="text-slate-500 text-xs hidden lg:inline tracking-wide uppercase">The Celestial Eye</span>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2.5 text-sm min-w-0">
        <ObjectSearch />

        {/* ── Location: styled as a search field, not an info chip ──────────────
            Magnifier icon + current location as the "value" + a Search hint make
            it read as a clickable search box. Opens the ObserverPicker (city
            search / geolocation / manual coords). */}
        <button
          onClick={() => setPickerOpen((o) => !o)}
          aria-expanded={pickerOpen}
          aria-label="Search observer location"
          title="Search a location"
          className="group flex items-center gap-2 rounded-full bg-white/[0.06] border border-white/10 pl-2.5 pr-2 sm:pr-2.5 py-1.5 hover:bg-white/10 hover:border-cyan-400/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 transition-all duration-150"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3.5 w-3.5 text-cyan-400 group-hover:text-cyan-300 transition-colors">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.2-3.2" />
          </svg>
          <span className="text-white font-medium leading-none">{observer.label}</span>
          <span className="text-slate-500 font-mono text-[11px] leading-none hidden xl:inline">
            {observer.latitude.toFixed(2)}°, {observer.longitude.toFixed(2)}°
          </span>
          <span className="hidden sm:inline text-[10px] uppercase tracking-wider text-slate-500 group-hover:text-cyan-300/90 border-l border-white/10 pl-2 ml-0.5 transition-colors">
            Search
          </span>
        </button>

        {/* ── Constellations: the hero CTA — glowing pill with a constant shine ── */}
        <Link
          href={`/constellations?lat=${observer.latitude}&lng=${observer.longitude}`}
          title="Explore constellations"
          aria-label="Explore constellations"
          className="shrink-0"
        >
          <span className="nav-shine nav-cta-glow group relative inline-flex items-center gap-1.5 rounded-full px-3 sm:px-3.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-cyan-500/90 via-sky-500/80 to-violet-500/90 border border-cyan-200/40 hover:brightness-110 transition-[filter] duration-150">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 drop-shadow">
              <path d="M12 2l1.7 5.1a2 2 0 0 0 1.2 1.2L20 10l-5.1 1.7a2 2 0 0 0-1.2 1.2L12 18l-1.7-5.1a2 2 0 0 0-1.2-1.2L4 10l5.1-1.7a2 2 0 0 0 1.2-1.2z" />
            </svg>
            <span className="hidden sm:inline tracking-wide">Constellations</span>
          </span>
        </Link>

        {/* Informational badges — hidden on phones to keep the bar to one row
            (the zenith count is also shown in the Zenith Window panel header). */}
        {zenithCount > 0 && (
          <span className="hidden sm:inline-block bg-cyan-500/10 backdrop-blur-sm border border-cyan-500/25 rounded-full px-3 py-1 text-cyan-300 text-xs font-medium">
            {zenithCount} in Zenith Window
          </span>
        )}

        {maxAltitude !== null && (
          <span className="hidden sm:inline-block bg-violet-500/10 backdrop-blur-sm border border-violet-500/25 rounded-full px-3 py-1 text-violet-300 text-xs font-medium font-mono">
            ↑ {maxAltitude.toFixed(1)}° max
          </span>
        )}

        {lastError ? (
          <span
            className="bg-red-500/10 text-red-400 border border-red-500/30 rounded-full px-2 sm:px-3 py-1 text-xs max-w-[8rem] sm:max-w-[14rem] truncate shrink-0"
            title={lastError}
          >
            ⚠ {lastError}
          </span>
        ) : (
          <span className="bg-white/[0.04] backdrop-blur-sm border border-white/10 rounded-full px-2 sm:px-3 py-1 text-slate-400 text-xs font-mono flex items-center gap-1.5 shrink-0">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                dataLoading ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-500/70 shadow-[0_0_6px_rgba(16,185,129,0.6)]'
              }`}
            />
            <span className="hidden sm:inline">{trackedCount} tracked</span>
          </span>
        )}
      </div>
    </div>

    <ObserverPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  )
}
