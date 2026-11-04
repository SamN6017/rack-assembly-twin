import { useEffect, useState } from 'react'
import { simClock } from '../store/simStore'

/** Simulation time for UI panels, polled a few times a second instead of re-rendering every frame. */
export function useSimTime(intervalMs = 250): number {
  const [t, setT] = useState(simClock.t)
  useEffect(() => {
    const id = setInterval(() => setT(simClock.t), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return t
}
