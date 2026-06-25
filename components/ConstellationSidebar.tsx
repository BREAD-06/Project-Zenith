'use client'

import type { RankedConstellation } from '@/lib/constellationUtils'

/**
 * Side menu listing every catalogued constellation, ranked by how close it is to
 * the observer's zenith (the point 90° overhead). The constellation nearest the
 * zenith — derived from the observer's real location — is flagged with a ZENITH
 * badge. Clicking any row selects it (the sky flies to and highlights it).
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
  return (
    <aside className="fixed right-3 sm:right-4 top-14 bottom-3 z-40 w-44 sm:w-52 flex flex-col pointer-events-auto">
      <div className="text-[10px] uppercase tracking-widest text-cyan-400/70 px-1 mb-1 shrink-0">
        Constellations · {ranked.length}
      </div>
      <div className="overflow-y-auto flex flex-col gap-1 pr-0.5">
        {ranked.map(({ constellation: c, altitude }) => {
          const isZenith = c.id === zenithId
          const isSelected = c.id === selectedId
          const belowHorizon = altitude < 0
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
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
  )
}
