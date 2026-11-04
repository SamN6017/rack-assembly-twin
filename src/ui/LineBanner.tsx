import { getPart } from '../data/parts'
import { useSim } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { dur } from './kanbanUi'
import { useSimTime } from './useSimTime'

/** Stopped-line alert over the 3D view, visible from every tab. Click a part to locate its POU. */
export function LineBanner() {
  const t = useSimTime(250)
  const line = useSim((s) => s.snapshot.line)
  const select = useUi((s) => s.select)
  if (!line.blocked) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
      <div className="pointer-events-auto flex max-w-[80%] items-center gap-3 rounded-md bg-red-950/85 px-3 py-1.5 text-[12px] text-red-100 shadow-lg ring-1 ring-red-500/60 backdrop-blur">
        <span className="flex items-center gap-1.5 font-semibold">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
          LINE STOPPED <span className="font-mono font-normal">{dur(t - line.since)}</span>
        </span>
        <span className="text-red-200/70">waiting for</span>
        <span className="flex flex-wrap gap-x-2">
          {line.keys.map((k) => {
            const [st, pn] = k.split(':')
            return (
              <button key={k} onClick={() => select(`pou:${st}:${pn}`, { focus: true })} className="font-mono hover:underline">
                {getPart(pn).description} @ {st}
              </button>
            )
          })}
        </span>
      </div>
    </div>
  )
}
