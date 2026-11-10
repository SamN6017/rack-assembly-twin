import { PLANNING_BASIS } from '../data/parts'
import { useUi, type CameraPreset, type Layer } from '../store/uiStore'
import { Row, Section } from './common'
import { AssemblyPanel } from './AssemblyPanel'
import { Playback } from './Playback'
import { ScenarioForm } from './ScenarioForm'

const VIEWS: { id: CameraPreset; label: string }[] = [
  { id: 'iso', label: 'Isometric' },
  { id: 'top', label: 'Top-down' },
  { id: 'kanban', label: 'Kanban area' },
  { id: 'line', label: 'Station' },
  { id: 'dsv', label: 'DSV warehouse' },
]

const LAYERS: { id: Layer; label: string; milestone?: number }[] = [
  { id: 'labels', label: 'Zone & station labels' },
  { id: 'signs', label: 'Hanging part-number signs' },
  { id: 'routes', label: 'Handler routes' },
  { id: 'overlays', label: 'Inventory overlays' },
]

export function LeftPanel() {
  const { setCamera, camera, layers, toggleLayer, selected, follow, setFollow, focusSelected } = useUi()
  const sub = 'rounded px-2 py-1.5 text-left text-xs ring-1 transition-colors disabled:cursor-not-allowed disabled:text-neutral-600 disabled:ring-white/5'
  return (
    <div className="text-neutral-300">
      <AssemblyPanel />

      <Section title="Planning basis" right={<span className="text-[10px] text-neutral-500">from sheet, read-only</span>}>
        <Row label="Baseline rate" value={`${PLANNING_BASIS.baselineRatePerHour} racks/h`} confidence="verified" />
        <Row label="Sheet basis" value={`${PLANNING_BASIS.dailyDemandRacks}/day · ${PLANNING_BASIS.hoursPerDay} h`} confidence="verified" />
        <Row label="= effective rate" value={`${PLANNING_BASIS.sheetRatePerHour.toFixed(2)} /h`} confidence="verified" />
        <Row label="Kanbans per part" value={PLANNING_BASIS.kanbansPerPart} confidence="verified" />
        <Row label="Lead time" value={`${PLANNING_BASIS.leadTimeHours} h`} confidence="verified" />
        <Row label="Safety stock" value={`${PLANNING_BASIS.safetyStockHours} h`} confidence="verified" />
        <Row label="Cycle times" value="—" confidence="placeholder" />
      </Section>

      <Playback />

      <ScenarioForm />

      <Section title="Camera">
        <div className="grid grid-cols-2 gap-1.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setCamera(v.id)}
              className={`rounded px-2 py-1.5 text-left text-xs ring-1 transition-colors ${camera.preset === v.id ? 'bg-sky-500/15 text-sky-200 ring-sky-500/40' : 'bg-white/[0.03] text-neutral-300 ring-white/10 hover:bg-white/[0.07]'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <button disabled={!selected} onClick={focusSelected} className={`${sub} bg-white/[0.03] text-neutral-300 ring-white/10 hover:bg-white/[0.07]`}>Focus selection</button>
          <button
            disabled={!selected}
            onClick={() => setFollow(follow ? null : selected)}
            className={`${sub} ${follow ? 'bg-sky-500/15 text-sky-200 ring-sky-500/40' : 'bg-white/[0.03] text-neutral-300 ring-white/10 hover:bg-white/[0.07]'}`}
          >
            {follow ? 'Stop following' : 'Follow selection'}
          </button>
          <button onClick={() => setCamera('iso')} className={`${sub} bg-white/[0.03] text-neutral-300 ring-white/10 hover:bg-white/[0.07]`}>Reset camera</button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">Drag to orbit · right-drag to pan · scroll to zoom · click to select · double-click to fly to · <kbd>F</kbd> focus · <kbd>Esc</kbd> clear</p>
      </Section>

      <Section title="Layers">
        {LAYERS.map((l) => (
          <label key={l.id} className={`flex items-center justify-between py-1 text-[13px] ${l.milestone ? 'text-neutral-600' : 'cursor-pointer'}`}>
            <span>{l.label}</span>
            {l.milestone ? (
              <span className="rounded bg-white/5 px-1 text-[10px] text-neutral-500">M{l.milestone}</span>
            ) : (
              <input type="checkbox" className="accent-sky-500" checked={layers[l.id]} onChange={() => toggleLayer(l.id)} />
            )}
          </label>
        ))}
        {layers.overlays && (
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">Kanban slots tinted by card state. Bars beside POU pallets show fill: green covers the next rack, amber cannot, red is starved, grey is not simulated.</p>
        )}
      </Section>
    </div>
  )
}
