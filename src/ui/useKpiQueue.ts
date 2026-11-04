import { useEffect, useState } from 'react'
import type { MovementConfig } from '../sim/movementSim'
import { cachedKpis, configKey, kpisFor } from '../store/simStore'

/** Configurations that threw (e.g. staffing beyond the bays), so the queue does not retry them forever. */
const failed = new Set<string>()

/** Computes missing scenario KPIs one at a time so the 3D view keeps animating between runs. */
export function useKpiQueue(configs: MovementConfig[]) {
  const [, bump] = useState(0)
  const waiting = configs.filter((c) => !cachedKpis(c) && !failed.has(configKey(c)))
  const pending = waiting[0]
  useEffect(() => {
    if (!pending) return
    const id = setTimeout(() => {
      try { kpisFor(pending) } catch { failed.add(configKey(pending)) }
      bump((n) => n + 1)
    }, 40)
    return () => clearTimeout(id)
  }, [pending])
  return waiting.length
}
