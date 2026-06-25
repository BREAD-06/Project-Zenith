'use client'

import type { ConstellationData } from '@/lib/constellationData'

/**
 * Detail panel for the selected constellation (Part 6). Glassmorphism card pinned
 * bottom-left, shown only while a constellation is selected. Lists the named stars
 * brighter than magnitude 2.5 with their magnitudes, and an OVERHEAD / NEAREST
 * status badge driven by the parent.
 */

interface ConstellationPanelProps {
  constellation: ConstellationData | null
  /** 'overhead' (green) when within 20° of the zenith, 'nearest' (amber) when it's
   *  merely the closest, or null to hide the status badge. */
  status: 'overhead' | 'nearest' | null
  onClose: () => void
}

export default function ConstellationPanel({
  constellation,
  status,
  onClose,
}: ConstellationPanelProps) {
  if (!constellation) return null

  // Named stars worth listing in the panel (brighter than mag 2.5), brightest first.
  const namedStars = constellation.stars
    .filter((s) => s.magnitude < 2.5)
    .sort((a, b) => a.magnitude - b.magnitude)

  return (
    <div
      className="constellation-panel-in fixed bottom-3 left-3 sm:bottom-4 sm:left-4 z-30 w-80 max-w-[calc(100vw-1.5rem)] bg-black/40 backdrop-blur-md border border-cyan-500/20 rounded-xl p-4 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            className="text-2xl font-bold text-white leading-tight"
            style={{ fontFamily: 'var(--font-space-grotesk), sans-serif' }}
          >
            {constellation.name}
          </h2>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded-full px-2 py-0.5 text-[11px] font-mono">
              {constellation.abbreviation}
            </span>
            {status === 'overhead' && (
              <span className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide">
                OVERHEAD
              </span>
            )}
            {status === 'nearest' && (
              <span className="bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide">
                NEAREST
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close constellation panel"
          className="text-slate-400 hover:text-white text-xl leading-none px-1 shrink-0"
        >
          ✕
        </button>
      </div>

      <p className="text-slate-400 text-sm italic mt-3 leading-relaxed">
        {constellation.mythology}
      </p>

      <div className="text-xs text-slate-500 font-mono mt-3">
        {constellation.stars.length} stars · {constellation.lines.length} connections
      </div>

      {namedStars.length > 0 && (
        <div className="mt-3 border-t border-white/5 pt-3">
          <div className="text-[10px] uppercase tracking-widest text-cyan-400/70 mb-1.5">
            Brightest stars
          </div>
          <ul className="flex flex-col gap-1">
            {namedStars.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-slate-200">{s.name}</span>
                <span className="text-[11px] text-slate-500 font-mono">
                  mag {s.magnitude.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
