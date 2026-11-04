import { useMemo, type ReactNode } from 'react'
import { buildRackAtStage, INSTALL_SEQUENCE } from '../assets/geometry/serverRack'
import { fallbackParts, type RenderPart } from '../assets/loadAsset'
import { ASSETS } from '../assets/manifest'
import { MATERIALS } from '../assets/materials'
import { COMPONENTS, stationParts } from '../data/components'
import { getPart, modelTab, PLANNING_BASIS } from '../data/parts'
import { PALLET, SERVER_RACK } from '../layout/constants'
import { LAYOUT } from '../layout/factoryLayout'
import { poseAt } from '../sim/movementSim'
import { formatClock, useSim } from '../store/simStore'
import { useSimTime } from './useSimTime'
import { resolveEntity, type Entity } from '../scene/entities'
import { useUi } from '../store/uiStore'
import { AssetPreview, type PreviewItem } from './AssetPreview'
import { ConfidenceBadge, Row, Section } from './common'
import { LiveStock } from './kanbanUi'
import { BoardPanel, RackInfo, StationAssembly } from './AssemblyDetails'
import { rackId } from '../sim/movementSim'

const KIND_LABEL: Record<Entity['kind'], string> = {
  kanbanPallet: 'Kanban pallet', pouPallet: 'Point-of-use pallet', lineRack: 'Rack on line', station: 'Workstation',
  finishedRack: 'Finished rack', equipment: 'Equipment', dsvStock: 'DSV stock',
  stagePallet: 'Staged replenishment pallet', handler: 'Material handler', assemblyRack: 'GPU rack',
}
const TAB_COLOR = { shared: 'bg-[#f2c218]', bloom: 'bg-[#2e9e4a]', yawn: 'ring-1 ring-neutral-500' }
const fmt = (n: number | null | undefined, unit = '') => (n === null || n === undefined ? '—' : `${n.toLocaleString()}${unit}`)

const rackParts = (stage: number): RenderPart[] => buildRackAtStage(stage).build().map((p) => ({ geometry: p.geometry, material: MATERIALS[p.mat] }))
const LINE_IDS = LAYOUT.stations.filter((s) => s.id !== 'SUBASSY').map((s) => s.id)

function LinkButton({ to, children }: { to: string; children: ReactNode }) {
  const select = useUi((s) => s.select)
  return (
    <button onClick={() => select(to, { focus: true })} className="font-mono text-sky-300 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-200">
      {children}
    </button>
  )
}

function Header({ entity }: { entity: Entity }) {
  const { focusSelected, follow, setFollow, select } = useUi()
  const following = follow === entity.id
  const btn = 'rounded px-2 py-1 text-[11px] ring-1 transition-colors'
  return (
    <div className="border-b border-white/10 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-400">{KIND_LABEL[entity.kind]}</div>
      <div className="mt-0.5 text-[15px] font-medium leading-snug text-neutral-100">{entity.label}</div>
      <div className="mt-1 font-mono text-[10px] text-neutral-500">{entity.id}</div>
      <div className="mt-2.5 flex gap-1.5">
        <button onClick={focusSelected} className={`${btn} bg-white/[0.04] text-neutral-200 ring-white/15 hover:bg-white/10`}>Focus <kbd className="text-neutral-500">F</kbd></button>
        <button onClick={() => setFollow(following ? null : entity.id)} className={`${btn} ${following ? 'bg-sky-500/20 text-sky-200 ring-sky-500/50' : 'bg-white/[0.04] text-neutral-200 ring-white/15 hover:bg-white/10'}`}>
          {following ? 'Following' : 'Follow'}
        </button>
        <button onClick={() => select(null)} className={`${btn} ml-auto text-neutral-400 ring-white/10 hover:text-neutral-200`}>Clear <kbd className="text-neutral-500">Esc</kbd></button>
      </div>
    </div>
  )
}

function PartDetails({ entity }: { entity: Entity }) {
  const part = getPart(entity.pn!)
  const c = COMPONENTS.get(part.pn)!
  const slot = entity.slotId ? LAYOUT.slots.find((s) => s.id === entity.slotId)! : LAYOUT.slots.find((s) => s.pn === part.pn)!
  const snapshot = useSim((s) => s.snapshot)
  const loadAsset = fallbackParts(c.asset)
  const preview: PreviewItem[] = [
    { parts: fallbackParts('pallet') },
    { parts: loadAsset, y: PALLET.height, scaleY: c.load.kind === 'rack' ? 1 : c.load.height },
  ]
  return (
    <>
      <Section title="Component">
        <Row label="Component ID" value={c.id} />
        <Row label="Part number" value={part.pn} confidence={part.pnConfidence} />
        {part.altPn && <Row label="Alternate PN" value={part.altPn} confidence="estimated" />}
        <Row label="Description" value={<span className="font-sans">{part.description}</span>} confidence={part.confidence} />
        <Row label="Model" value={<span className="flex items-center gap-1.5 font-sans"><span className={`h-2.5 w-2.5 rounded-sm ${TAB_COLOR[modelTab(part)]}`} />{part.models.join(' + ')}</span>} />
        {part.supplier && <Row label="Supplier" value={<span className="font-sans text-[12px]">{part.supplier}</span>} />}
      </Section>
      <Section title="Bill of materials">
        <Row label="Qty per rack" value={fmt(part.qtyPerRack)} confidence={part.qtyPerRack === null ? 'placeholder' : 'verified'} />
        <Row label="Qty per pallet" value={fmt(part.qtyPerPallet)} confidence={part.qtyPerPallet === null ? 'placeholder' : 'verified'} />
        <Row label="Kanban size" value={`${part.kanbanPallets} pallets`} confidence="verified" />
        <Row label="Hours per Kanban" value={`${part.hoursPerKanban.toFixed(2)} h`} confidence={part.confidence} />
        <p className="mt-1 text-[11px] text-neutral-500">Hours at the sheet basis of {PLANNING_BASIS.sheetRatePerHour.toFixed(2)} racks/h.</p>
      </Section>
      <Section title="Location">
        <Row label="Storage" value={<span className="font-sans">Aisle {slot.aisleId} · {slot.side === 'N' ? 'north' : 'south'} row</span>} confidence="estimated" />
        <div className="flex items-center justify-between py-1 text-[13px]">
          <span className="text-neutral-400">Kanbans</span>
          <span className="flex gap-2">{c.storageSlots.map((s, i) => <LinkButton key={s} to={`kanban:${s}:0`}>#{i + 1}{s === entity.slotId ? ' ●' : ''}</LinkButton>)}</span>
        </div>
        {entity.palletIndex !== undefined && <Row label="This pallet" value={`${entity.palletIndex + 1} of ${part.kanbanPallets}`} />}
        <div className="flex items-center justify-between py-1 text-[13px]">
          <span className="text-neutral-400">POU destination</span>
          {c.pouDestination ? <LinkButton to={`station:${c.pouDestination.station}`}>{c.pouDestination.station}</LinkButton> : <span className="flex items-center gap-2 text-neutral-500">— <ConfidenceBadge value="placeholder" /></span>}
        </div>
      </Section>
      <Section title="Inventory (V1 start state)">
        <Row label="Per full Kanban" value={fmt(c.inventory.perKanban, ' pcs')} confidence={c.inventory.confidence} />
        <Row label="Kanban storage" value={fmt(c.inventory.initialKanbanStock, ' pcs')} confidence={c.inventory.confidence} />
        <Row label="Point of use" value={fmt(c.inventory.initialPouStock, ' pcs')} confidence={c.inventory.confidence} />
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">Every Kanban starts full (slide P1). POU pallets start part-used (seeded).</p>
      </Section>
      <LiveStock part={part} storageSlots={c.storageSlots} pou={c.pouDestination?.station ?? null} snapshot={snapshot} />
      <Section title="3D model">
        <AssetPreview items={preview} />
        <Row label="Asset" value={c.asset} />
        <Row label="Load" value={`${PALLET.width.toFixed(2)} × ${PALLET.length.toFixed(2)} × ${(PALLET.height + c.load.height).toFixed(2)} m`} confidence="estimated" />
        <Row label="Part dimensions" value="not in sources" confidence="placeholder" />
        <p className="mt-1 text-[11px] text-neutral-500">{c.appearance}. Geometry: {c.geometryConfidence}.</p>
      </Section>
    </>
  )
}

function StationDetails({ entity }: { entity: Entity }) {
  const id = entity.stationId!
  const st = LAYOUT.stations.find((s) => s.id === id)!
  const { kanban, small } = stationParts(id)
  const install = INSTALL_SEQUENCE.find((s) => s.station === id)
  const pou = useSim((s) => s.snapshot.pou)
  const backorder = useSim((s) => s.snapshot.backorder)
  const here = useSim((s) => s.snapshot.atStation.get(id === 'SUBASSY' ? 'WS4' : id))
  const line = useSim((s) => s.snapshot.line)
  const waiting = line.blocked ? line.keys.filter((k) => k.startsWith(`${id}:`)) : []
  return (
    <>
      {line.blocked && (
        <div className={`mx-4 mt-3 rounded px-2 py-1.5 text-[12px] ring-1 ${waiting.length ? 'bg-red-500/10 text-red-200 ring-red-500/40' : 'bg-amber-500/10 text-amber-200 ring-amber-500/30'}`}>
          {waiting.length
            ? <>Line stopped: this station is short of {waiting.map((k) => getPart(k.split(':')[1]).description).join(', ')}.</>
            : <>Line stopped by another station; this station waits with it (paced line).</>}
        </div>
      )}
      {id !== 'SUBASSY' && <StationAssembly stationId={id} />}
      <Section title="Station">
        <Row label="Station" value={id} confidence={st.confidence} />
        <Row label="Cycle time" value="—" confidence="placeholder" />
        {install && <Row label="Installs" value={<span className="max-w-[170px] text-right font-sans text-[12px]">{install.items}</span>} />}
        {id === 'SUBASSY' && here && <Row label="Building for" value={`${rackId(here.rack)} · ${here.model}`} confidence="placeholder" />}
      </Section>
      <Section title={`Pallet parts consumed (${kanban.length})`}>
        {kanban.length === 0 && <p className="text-[12px] text-neutral-500">{id === 'WS6' ? 'WS6 content is not visible in the photos.' : 'None'}</p>}
        <ul className="space-y-1">
          {kanban.map((p) => {
            const staged = st.pou.some((x) => x.pn === p.pn)
            const pcs = pou.get(`${id}:${p.pn}`)
            const owed = backorder.get(`${id}:${p.pn}`)
            return (
              <li key={p.pn} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="text-neutral-300">{p.description}{p.models.length === 1 ? <span className="text-neutral-500"> · {p.models[0]}</span> : null}</span>
                <span className="flex items-center gap-2 font-mono">
                  <span className="text-neutral-400">×{p.qtyPerRack ?? '?'}</span>
                  {pcs !== undefined && <span className={owed ? 'text-red-300' : pcs < (p.qtyPerRack ?? 0) ? 'text-amber-300' : 'text-neutral-300'} title="Pieces at point of use now">{owed ? `short ${owed}` : `${pcs} pcs`}</span>}
                  {staged ? <LinkButton to={`pou:${id}:${p.pn}`}>{p.pn}</LinkButton> : <LinkButton to={`kanban:${p.pn}#0:0`}>{p.pn}</LinkButton>}
                </span>
              </li>
            )
          })}
        </ul>
      </Section>
      <Section title={`2-bin small parts (${small.length})`}>
        <ul className="space-y-1">
          {small.map((s, i) => (
            <li key={`${s.pn}-${i}`} className="flex justify-between text-[12px]">
              <span className="text-neutral-300">{s.description}</span>
              <span className="font-mono text-neutral-400">{s.pn} · {s.qtyPerRack === 'roll' ? 'roll' : `×${s.qtyPerRack}`}</span>
            </li>
          ))}
          {small.length === 0 && <li className="text-[12px] text-neutral-500">None listed</li>}
        </ul>
        <p className="mt-1.5 text-[11px] text-neutral-500">Qty per rack verified; part-number digits read from photo.</p>
      </Section>
    </>
  )
}

function RackDetails({ stage }: { stage: number }) {
  const parts = useMemo(() => rackParts(stage), [stage])
  return (
    <>
      <Section title="Installed so far">
        <ol className="space-y-1">
          {INSTALL_SEQUENCE.slice(0, stage + 1).map((s) => (
            <li key={s.station} className="flex gap-2 text-[12px]"><span className="w-9 font-mono text-sky-300">{s.station}</span><span className="text-neutral-300">{s.items}</span></li>
          ))}
        </ol>
        <p className="mt-1.5 text-[11px] text-neutral-500">Quantities from the BOM. Positions inside the rack are illustrative.</p>
      </Section>
      <Section title="3D model">
        <AssetPreview items={[{ parts }]} height={230} />
        <Row label="Frame" value={`${SERVER_RACK.width} × ${SERVER_RACK.depth} × ${SERVER_RACK.height} m`} confidence="estimated" />
        <Row label="Rack PN" value="1225629" confidence="verified" />
        <Row label="Model" value="Yawn / Bloom not tracked yet" confidence="placeholder" />
      </Section>
    </>
  )
}

function EquipmentDetails({ entity }: { entity: Entity }) {
  const a = ASSETS[entity.assetId!]
  return (
    <Section title="Asset">
      <AssetPreview items={[{ parts: fallbackParts(a.id) }]} />
      <Row label="Asset ID" value={a.id} />
      <Row label="Size" value={a.dims.map((d) => d.toFixed(2)).join(' × ') + ' m'} confidence={a.confidence} />
      <Row label="Geometry" value={<span className="font-sans text-[12px]">{a.geometry}</span>} />
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">{a.basis}</p>
    </Section>
  )
}

const PHASE_LABEL: Record<string, string> = {
  idle: 'Parked', 'to-pick': 'Travelling to pick', turning: 'Turning', loading: 'Loading', transporting: 'Transporting',
  unloading: 'Unloading', returning: 'Returning to bay', waiting: 'Waiting for route to clear',
}

function HandlerDetails({ entity }: { entity: Entity }) {
  const t = useSimTime()
  const result = useSim((s) => s.result)
  const cfg = useSim((s) => s.config)
  const h = result.handlers.find((x) => x.id === entity.handlerId)!
  const pose = poseAt(h, t)
  const task = pose.taskId ? result.tasks.find((x) => x.id === pose.taskId) : undefined
  const done = result.tasks.filter((x) => x.handler === h.id && x.doneAt <= t)
  let busy = 0
  let waiting = 0
  let dist = 0
  for (const s of h.segs) {
    if (s.t0 >= t) break
    const span = Math.min(s.t1, t) - s.t0
    if (s.phase === 'waiting') waiting += span
    else if (s.phase !== 'idle') busy += span
    if (s.kind === 'move') dist += s.t1 <= t ? s.path.length : 0
  }
  return (
    <>
      <Section title="Now">
        <Row label="Role" value={h.role === 'CLS' ? 'CLS (Kanban → POU)' : 'DSV (staging → Kanban)'} />
        <Row label="State" value={<span className="font-sans">{PHASE_LABEL[pose.phase]}</span>} />
        <Row label="Carrying" value={pose.load ? <LinkButton to={`kanban:${pose.load.pn}#0:0`}>{pose.load.pn}</LinkButton> : '—'} />
        <Row label="Speed" value={`${pose.speed.toFixed(2)} m/s`} />
        {task && (
          <>
            <Row label="Task" value={`${task.id} · ${task.kind === 'pou-delivery' ? 'POU delivery' : 'Kanban refill'}`} />
            <Row label="From → to" value={<span className="text-[11px]">{task.from.replace(/^kp:/, '').replace(/:\d+$/, '')} → {task.to.replace(/^kp:/, '')}</span>} />
            <Row label="Requested" value={formatClock(task.requestedAt)} />
            <Row label="Delivery" value={formatClock(task.deliveredAt)} />
          </>
        )}
      </Section>
      <Section title="So far this run">
        <Row label="Trips completed" value={done.length} />
        <Row label="Distance" value={`${(dist / 1000).toFixed(2)} km`} />
        <Row label="Utilisation" value={t > 0 ? `${((busy / t) * 100).toFixed(0)}%` : '—'} confidence="estimated" />
        <Row label="Waiting for routes" value={`${Math.round(waiting)} s`} />
      </Section>
      <Section title="Assumptions">
        <Row label="Speed empty / loaded" value={`${cfg.vEmpty} / ${cfg.vLoaded} m/s`} confidence="estimated" />
        <Row label="Acceleration" value={`${cfg.accel} m/s²`} confidence="estimated" />
        <Row label="Load / unload" value={`${cfg.loadS} / ${cfg.unloadS} s`} confidence="estimated" />
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">Handler count, speeds and handling times are not in the sources. They become scenario controls in Milestone 5.</p>
      </Section>
    </>
  )
}

export function Details({ id }: { id: string }) {
  const entity = resolveEntity(id)
  if (!entity) return <Section title="Selection"><p className="text-[12px] text-red-300">Unknown object {id}</p></Section>
  return (
    <div>
      <Header entity={entity} />
      {(entity.kind === 'kanbanPallet' || entity.kind === 'pouPallet' || entity.kind === 'stagePallet') && <PartDetails entity={entity} />}
      {entity.kind === 'handler' && <HandlerDetails entity={entity} />}
      {entity.kind === 'station' && <StationDetails entity={entity} />}
      {entity.kind === 'lineRack' && <RackDetails stage={LINE_IDS.indexOf(entity.stationId!)} />}
      {entity.kind === 'assemblyRack' && <RackInfo rackNo={entity.rackNo!} />}
      {entity.kind === 'finishedRack' && <RackDetails stage={LINE_IDS.length - 1} />}
      {entity.kind === 'equipment' && entity.assetId === 'kanbanBoard' && <BoardPanel />}
      {entity.kind === 'equipment' && <EquipmentDetails entity={entity} />}
      {entity.kind === 'dsvStock' && (
        <Section title="DSV stock">
          <Row label="Contents" value="unknown" confidence="placeholder" />
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">The photos show DSV high-bay racking but no layout or stock data. These pallets are generated to make the warehouse readable and carry no inventory.</p>
        </Section>
      )}
    </div>
  )
}
