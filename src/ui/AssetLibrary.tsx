import { ASSETS, loadProfile, type AssetId } from '../assets/manifest'
import { KANBAN_PARTS } from '../data/parts'
import { useAssetStatus } from '../assets/loadAsset'
import { useUi } from '../store/uiStore'
import { ConfidenceBadge } from './common'

const SOURCE_STYLE = {
  fallback: 'text-amber-300',
  glb: 'text-emerald-300',
  'glb-rejected': 'text-red-300',
}

const firstPart = (kind: 'carton' | 'crate') => KANBAN_PARTS.find((p) => loadProfile(p).kind === kind)!.pn

/** An entity that shows each asset in the factory, for "Show in factory". */
const EXAMPLE: Partial<Record<AssetId, string>> = {
  pallet: `kanban:${firstPart('carton')}#0:0`,
  cartonStack: `kanban:${firstPart('carton')}#0:0`,
  crate: `kanban:${firstPart('crate')}#0:0`,
  wrappedRack: 'kanban:1225629#0:0',
  rackFrame: 'rack:WS1',
  rackingBay: 'dsv:0',
  uprightFrame: 'dsv:0',
  bench: 'station:WS3',
  palletJack: 'handler:H1',
  cart: 'equip:cart:0',
  twoBinShelving: 'equip:twoBinShelving:0',
  kanbanBoard: 'equip:kanbanBoard:0',
}

export function AssetLibrary() {
  const status = useAssetStatus()
  const setTab = useUi((s) => s.setTab)
  const select = useUi((s) => s.select)
  const show = (id: string) => {
    setTab('factory')
    select(id, { focus: true })
  }
  return (
    <div className="absolute inset-0 z-30 overflow-auto bg-neutral-950/92 p-6 backdrop-blur-sm">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Asset library</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-neutral-400">
            No CAD or GLB files have been supplied, so every model below is a procedural approximation built from real-world proportions.
            Put a GLB in <code className="text-neutral-200">public/models/</code> and set its path in <code className="text-neutral-200">src/assets/manifest.ts</code>: it is
            loaded, its bounding box is checked against the expected size (±25%) and floor origin, and the procedural model is kept if the check fails.
          </p>
        </div>
        <button onClick={() => setTab('factory')} className="rounded px-3 py-1.5 text-xs text-neutral-300 ring-1 ring-white/15 hover:bg-white/5">Back to factory</button>
      </div>
      <table className="w-full text-left text-[12px]">
        <thead className="text-[10px] uppercase tracking-wider text-neutral-500">
          <tr>{['Asset', 'Size x · y · z (m)', 'Source', 'Geometry', 'Data', 'Basis', 'Licence', ''].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {Object.values(ASSETS).map((a) => {
            const s = status[a.id]
            return (
              <tr key={a.id} className="border-t border-white/5 align-top">
                <td className="px-3 py-2">
                  <div className="text-neutral-100">{a.name}</div>
                  <div className="font-mono text-[11px] text-neutral-500">{a.id}{a.partNumbers ? ` · PN ${a.partNumbers.join(', ')}` : ''}</div>
                </td>
                <td className="px-3 py-2 font-mono text-neutral-300">{a.dims.map((d) => d.toFixed(2)).join(' · ')}</td>
                <td className={`px-3 py-2 ${SOURCE_STYLE[s?.source ?? 'fallback']}`}>
                  {s?.source === 'glb' ? 'GLB' : s?.source === 'glb-rejected' ? 'GLB rejected → procedural' : 'Procedural'}
                  {s?.note && <div className="text-[11px] text-neutral-500">{s.note}</div>}
                </td>
                <td className="px-3 py-2 text-neutral-400">{a.geometry}</td>
                <td className="px-3 py-2"><ConfidenceBadge value={a.confidence} /></td>
                <td className="px-3 py-2 text-neutral-400">{a.basis}</td>
                <td className="px-3 py-2 text-neutral-500">{a.license}</td>
                <td className="px-3 py-2">
                  {EXAMPLE[a.id] && (
                    <button onClick={() => show(EXAMPLE[a.id]!)} className="whitespace-nowrap rounded px-2 py-1 text-[11px] text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/10">Show in factory</button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
