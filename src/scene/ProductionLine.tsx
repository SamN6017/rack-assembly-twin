import { useMemo } from 'react'
import { getPart } from '../data/parts'
import { loadProfile } from '../assets/manifest'
import { LAYOUT } from '../layout/factoryLayout'
import { useSim } from '../store/simStore'
import { AssetInstances, PalletLoads, mat4, type PalletLoad } from './Instanced'

/**
 * Station furniture and point-of-use pallets. The racks themselves move on the assembly line
 * (LineRacks); finished racks appear in staging as they are completed.
 */
export function ProductionLine() {
  const benches = useMemo(() => ({
    m: LAYOUT.stations.map((s) => mat4(s.bench.x, 0, s.bench.z, s.id === 'SUBASSY' ? Math.PI / 2 : 0)),
    ids: LAYOUT.stations.map((s) => `station:${s.id}`),
  }), [])
  // POU pallets lie along X: the direction the pallet jack pushes them in.
  const pou = useMemo<PalletLoad[]>(() => LAYOUT.stations.flatMap((s) => s.pou.map((p) => ({
    x: p.x, z: p.z, rotY: Math.PI / 2, profile: loadProfile(getPart(p.pn)), id: `pou:${s.id}:${p.pn}`,
  }))), [])
  const present = useSim((s) => s.snapshot.pou)
  const emptyPou = useMemo(() => new Set([...present].filter(([, v]) => !v).map(([k]) => `pou:${k}`)), [present])
  return (
    <group>
      <AssetInstances id="bench" matrices={benches.m} ids={benches.ids} />
      <PalletLoads items={pou} hidden={emptyPou} />
    </group>
  )
}
