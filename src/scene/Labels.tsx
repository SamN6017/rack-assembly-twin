import { Html } from '@react-three/drei'
import type { Confidence } from '../data/parts'
import { LAYOUT, type Rect } from '../layout/factoryLayout'
import { useUi } from '../store/uiStore'

const centre = (r: Rect): [number, number] => [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2]

interface Tag { id: string; text: string; x: number; z: number; y?: number; kind: 'zone' | 'station'; confidence: Confidence }

function tags(): Tag[] {
  const L = LAYOUT
  const z = L.zones
  const out: Tag[] = [
    { id: 'kanban', text: 'Kanban area · "Blue Box"', x: centre(L.kanbanArea)[0], z: L.kanbanArea.minZ - 1.6, kind: 'zone', confidence: 'verified' },
    { id: 'm-aisle', text: 'M-shelf aisle', x: centre(L.middleAisle)[0], z: centre(L.middleAisle)[1], kind: 'zone', confidence: 'verified' },
    { id: 'dsv', text: 'DSV warehouse (illustrative)', x: centre(z.dsvRacking)[0], z: z.dsvRacking.minZ - 2, y: 7, kind: 'zone', confidence: 'placeholder' },
    { id: 'dsv-stage', text: 'DSV staging', x: centre(z.dsvStaging)[0], z: z.dsvStaging.minZ - 0.8, kind: 'zone', confidence: 'estimated' },
    { id: 'handler', text: 'Material handler floor', x: centre(z.handlerFloor)[0], z: 46, kind: 'zone', confidence: 'estimated' },
    { id: 'finished', text: 'Finished rack staging', x: centre(z.finishedStaging)[0], z: z.finishedStaging.minZ - 1, y: 3, kind: 'zone', confidence: 'estimated' },
    { id: 'main', text: 'Main aisle', x: centre(z.mainAisle)[0], z: 53, kind: 'zone', confidence: 'estimated' },
    { id: 'board', text: 'Kanban board', x: L.kanbanBoard.x, z: L.kanbanBoard.z, y: 2.6, kind: 'zone', confidence: 'verified' },
    { id: 'cls-park', text: 'CLS handler bays', x: 38.6, z: L.parkingSpots[0].z - 1.5, y: 1.2, kind: 'zone', confidence: 'estimated' },
    { id: 'twobin', text: 'Small parts 2-bin', x: L.smallPartsRacks[0].x - 1, z: L.smallPartsRacks[0].z, y: 2.4, kind: 'zone', confidence: 'verified' },
  ]
  for (const s of L.stations) out.push({ id: s.id, text: s.id === 'WS6' ? 'WS6 (contents unknown)' : s.label, x: s.rack.x, z: s.rack.z, y: 2.9, kind: 'station', confidence: s.confidence })
  return out
}

const TAGS = tags()

const DOT: Record<Confidence, string> = { verified: 'bg-emerald-400', estimated: 'bg-amber-400', placeholder: 'bg-neutral-400' }

export function Labels() {
  // Html labels sit in the DOM above the canvas, so hide them under full-screen overlays.
  // They stay mounted and are hidden with CSS: each drei Html is its own React root, and
  // unmounting a batch of them mid-render makes React throw (removeChild on a detached node).
  const show = useUi((s) => s.layers.labels && s.tab === 'factory')
  return (
    <>
      {TAGS.map((t) => (
        <Html key={t.id} position={[t.x, t.y ?? 0.4, t.z]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none', display: show ? 'block' : 'none' }}>
          <div className={`flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium shadow-lg ring-1 ${t.kind === 'station' ? 'bg-sky-950/85 text-sky-100 ring-sky-500/40' : 'bg-neutral-900/80 text-neutral-200 ring-white/10'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${DOT[t.confidence]}`} />
            {t.text}
          </div>
        </Html>
      ))}
    </>
  )
}
