'use client'

import { useState } from 'react'
import type { RankedConstellation } from '@/lib/constellationUtils'

/**
 * Side menu listing every catalogued constellation, ranked by how close it is to
 * the observer's zenith (the point 90° overhead). The constellation nearest the
 * zenith — derived from the observer's real location — is flagged with a ZENITH
 * badge. Clicking any row selects it (the sky flies to and highlights it).
 *
 * Responsive: a persistent panel on tablet/desktop (sm+); on phones it collapses
 * behind a floating toggle so it doesn't blanket the sky, and auto-closes when a
 * constellation is picked so the fly-in is visible.
 */

interface ConstellationSidebarProps {
  ranked: RankedConstellation[]
  /** id of the constellation nearest the zenith (gets the ZENITH badge). */
  zenithId: string | null
  /** id of the user-selected constellation, or null. */
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function ConstellationSidebar({
  ranked,
  zenithId,
  selectedId,
  onSelect,
}: ConstellationSidebarProps) {
  // Mobile-only open state; on sm+ the panel is always shown via `sm:flex`.
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile toggle — shown only while the list is closed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Show constellation list"
          className="sm:hidden fixed top-4 right-4 z-50 flex items-center gap-1.5 bg-black/50 backdrop-blur-md border border-cyan-500/20 text-cyan-300 text-xs font-mono px-3 py-2 rounded-full hover:bg-cyan-500/10 transition-all"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          List
        </button>
      )}

      <aside
        className={`fixed right-3 sm:right-4 top-14 bottom-3 z-40 w-44 sm:w-52 max-w-[80vw] flex-col pointer-events-auto ${
          open ? 'flex' : 'hidden'
        } sm:flex`}
      >
        <div className="flex items-center justify-between px-1 mb-1 shrink-0">
          <span className="text-[10px] uppercase tracking-widest text-cyan-400/70">
            Constellations · {ranked.length}
          </span>
          <button
            onClick={() => setOpen(false)}
            aria-label="Hide constellation list"
            className="sm:hidden text-slate-400 hover:text-cyan-300 text-sm leading-none px-1"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto flex flex-col gap-1 pr-0.5">
          {ranked.map(({ constellation: c, altitude }) => {
            const isZenith = c.id === zenithId
            const isSelected = c.id === selectedId
            const belowHorizon = altitude < 0
            return (
              <button
                key={c.id}
                onClick={() => {
                  onSelect(c.id)
                  setOpen(false) // collapse on mobile so the fly-in is visible
                }}
                title={`${c.name} — altitude ${altitude.toFixed(0)}°`}
                className={`text-left rounded-lg px-2.5 py-1.5 border transition-all duration-150 ${
                  isSelected
                    ? 'bg-amber-400/15 border-amber-400/50'
                    : isZenith
                      ? 'bg-emerald-500/10 border-emerald-400/40'
                      : 'bg-black/30 border-white/5 hover:border-cyan-400/40 hover:bg-cyan-500/10'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span
                    className={`text-sm font-medium truncate ${
                      isSelected ? 'text-amber-200' : belowHorizon ? 'text-slate-500' : 'text-slate-100'
                    }`}
                  >
                    {c.name}
                  </span>
                  {isZenith && (
                    <span className="shrink-0 flex items-center gap-1 text-[9px] font-bold tracking-wide text-emerald-300">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      ZENITH
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[10px] text-slate-500 font-mono">{c.abbreviation}</span>
                  <span
                    className={`text-[10px] font-mono ${
                      belowHorizon ? 'text-slate-600' : 'text-cyan-300/70'
                    }`}
                  >
                    {belowHorizon ? 'below horizon' : `alt ${altitude.toFixed(0)}°`}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </aside>
    </>
  )
}
