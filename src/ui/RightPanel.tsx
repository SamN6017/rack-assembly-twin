import { KANBAN_PARTS } from '../data/parts'
import { INSTALL_SEQUENCE } from '../assets/geometry/serverRack'
import { LAYOUT } from '../layout/factoryLayout'
import { useUi } from '../store/uiStore'
import { ConfidenceBadge, Row, Section } from './common'
import { Details } from './Details'

const kanbanPallets = LAYOUT.slots.reduce((n, s) => n + s.pallets.length, 0)
const pouPallets = LAYOUT.stations.reduce((n, s) => n + s.pou.length, 0)
const area = LAYOUT.kanbanArea

export function RightPanel() {
  const selected = useUi((s) => s.selected)
  if (selected) return <Details id={selected} />
  return (
    <div>
      <Section title="Factory summary">
        <Row label="Kanban part numbers" value={KANBAN_PARTS.length} confidence="verified" />
        <Row label="Kanban slots" value={LAYOUT.slots.length} confidence="verified" />
        <Row label="Pallets in Kanban area" value={kanbanPallets} confidence="verified" />
        <Row label="POU pallets" value={pouPallets} confidence="verified" />
        <Row label="Kanban area" value={`${(area.maxX - area.minX).toFixed(0)} × ${(area.maxZ - area.minZ).toFixed(1)} m`} confidence="estimated" />
        <Row label="Line stations" value={`${LAYOUT.stations.length - 1} + sub-assy`} confidence="verified" />
      </Section>

      <Section title="Rack build-up along the line">
        <ol className="space-y-1.5">
          {INSTALL_SEQUENCE.map((s, i) => {
            const st = LAYOUT.stations.find((x) => x.id === s.station)!
            return (
              <li key={s.station} className="text-[12px] leading-snug">
                <div className="flex justify-between gap-2"><span className="text-sky-300">{i + 1} · {st.name}</span><span className="font-mono text-[10px] text-neutral-500">{st.steps.join(' ') || 'no sheet steps'}</span></div>
                <div className={st.steps.length ? 'text-neutral-300' : 'text-neutral-500'}>{s.items}</div>
              </li>
            )
          })}
        </ol>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          Five stations as described by the line team; which sheet steps (WS…) each one does is inferred from the parts (estimated). Quantities per rack are from the BOM. Where each item sits inside the rack is illustrative.
        </p>
      </Section>

      <Section title="Legend">
        <div className="space-y-1.5 text-[12px]">
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[#f2c218]" /> Shared part (Yawn + Bloom)</div>
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[#2e9e4a]" /> Bloom-only part</div>
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-white ring-1 ring-neutral-500" /> Yawn-only part (no tab)</div>
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[#1f5fd1]" /> Kanban area boundary</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <ConfidenceBadge value="verified" />
          <ConfidenceBadge value="estimated" />
          <ConfidenceBadge value="placeholder" />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          Layout dimensions are estimates until a floor plan is supplied. All 3D models are procedural approximations; see Asset Library.
        </p>
      </Section>

      <Section title="Selection">
        <p className="text-[12px] leading-relaxed text-neutral-500">
          Click a pallet, rack, bench or piece of equipment to inspect it. Double-click to fly to it. Rows in the parts table select that part's Kanban.
        </p>
      </Section>
    </div>
  )
}
