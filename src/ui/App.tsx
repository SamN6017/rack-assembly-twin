import { useEffect } from 'react'
import { FactoryScene } from '../scene/FactoryScene'
import { useUi, type Tab } from '../store/uiStore'
import { AssetLibrary } from './AssetLibrary'
import { BottomPanel } from './BottomPanel'
import { CompareView } from './CompareView'
import { KanbanBoard } from './KanbanBoard'
import { LeftPanel } from './LeftPanel'
import { LineBanner } from './LineBanner'
import { WalkHud } from './WalkHud'
import { RightPanel } from './RightPanel'
import { SimulatorPanel } from './SimulatorPanel'

const TABS: { id: Tab; label: string; milestone?: number }[] = [
  { id: 'factory', label: 'Factory Overview' },
  { id: 'kanban', label: 'Kanban Board' },
  { id: 'simulator', label: 'Production Simulator' },
  { id: 'compare', label: 'Scenario Comparison' },
  { id: 'assets', label: 'Asset Library' },
]

function TopNav() {
  const { tab, setTab, setCamera } = useUi()
  return (
    <header className="col-span-3 flex h-12 items-center gap-6 border-b border-white/10 bg-neutral-950 px-4">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold tracking-tight text-neutral-100">Rack Assembly Digital Twin</span>
        <span className="text-xs text-neutral-500">Ghostfish · V1 · Milestone 6</span>
      </div>
      <nav className="flex h-full items-stretch">
        {TABS.map((t) => {
          const disabled = t.milestone !== undefined
          return (
            <button
              key={t.id}
              disabled={disabled}
              onClick={() => {
                if (t.id === 'kanban' && tab !== 'kanban') setCamera('kanban')
                setTab(t.id)
              }}
              title={disabled ? `Arrives in Milestone ${t.milestone}` : undefined}
              className={`border-b-2 px-3 text-[13px] transition-colors ${tab === t.id ? 'border-sky-400 text-neutral-100' : 'border-transparent text-neutral-400 hover:text-neutral-200'} disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:text-neutral-600`}
            >
              {t.label}
              {disabled && <span className="ml-1.5 rounded bg-white/5 px-1 text-[10px] text-neutral-500">M{t.milestone}</span>}
            </button>
          )
        })}
      </nav>
    </header>
  )
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return
      const ui = useUi.getState()
      if (ui.cameraMode === 'walk') return  // WASD and Esc belong to the walkthrough
      if (e.key === 'Escape') ui.select(null)
      else if (e.key === 'f' || e.key === 'F') ui.focusSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App() {
  useShortcuts()
  const tab = useUi((s) => s.tab)
  return (
    <div className={`grid h-full grid-cols-[288px_minmax(0,1fr)_320px] bg-neutral-950 ${tab === 'compare' ? 'grid-rows-[48px_minmax(0,1fr)_minmax(0,62%)]' : tab === 'kanban' || tab === 'simulator' ? 'grid-rows-[48px_minmax(0,1fr)_minmax(0,54%)]' : 'grid-rows-[48px_minmax(0,1fr)_300px]'}`}>
      <TopNav />
      <aside className="row-span-2 overflow-y-auto border-r border-white/10 bg-[#111214]">
        <LeftPanel />
      </aside>
      <main className="relative min-h-0">
        <FactoryScene />
        {tab === 'assets' && <AssetLibrary />}
        <LineBanner />
        <WalkHud />
      </main>
      <aside className="overflow-y-auto border-l border-white/10 bg-[#111214]">
        <RightPanel />
      </aside>
      <footer className="col-span-2 min-h-0 border-t border-white/10 bg-[#111214]">
        {tab === 'kanban' ? <KanbanBoard /> : tab === 'simulator' ? <SimulatorPanel /> : tab === 'compare' ? <CompareView /> : <BottomPanel />}
      </footer>
    </div>
  )
}
