import { useMemo } from 'react'
import { getPart } from '../data/parts'
import { loadProfile } from '../assets/manifest'
import { MATERIALS } from '../assets/materials'
import { buildRackAtStage } from '../assets/geometry/serverRack'
import type { RenderPart } from '../assets/loadAsset'
import { LAYOUT } from '../layout/factoryLayout'
import { useSim } from '../store/simStore'
import { AssetInstances, PalletLoads, PartsInstances, PartsModel, mat4, type PalletLoad } from './Instanced'

const toRender = (stage: number): RenderPart[] =>
  buildRackAtStage(stage).build().map((p) => ({ geometry: p.geometry, material: MATERIALS[p.mat] }))

// Rack front (+Z in model space) faces the bench on the main-aisle side (+X).
const FACE_BENCH = Math.PI / 2

const LINE_STATIONS = LAYOUT.stations.filter((s) => s.id !== 'SUBASSY')

/**
 * One rack per station, showing what has been installed up to that station. Each line rack is a
 * separate model so later milestones can select, move and follow it.
 */
export function ProductionLine() {
  const rackModels = useMemo(() => LINE_STATIONS.map((_, i) => toRender(i)), [])
  const finished = useMemo(() => toRender(LINE_STATIONS.length - 1), [])

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
  const finishedSpots = useMemo(() => ({
    m: LAYOUT.finishedRackSpots.map((p) => mat4(p.x, 0, p.z, 0)),
    ids: LAYOUT.finishedRackSpots.map((_, i) => `finished:${i}`),
  }), [])

  return (
    <group>
      {LINE_STATIONS.map((s, i) => (
        <PartsModel key={s.id} entityId={`rack:${s.id}`} parts={rackModels[i]} position={[s.rack.x, 0, s.rack.z]} rotY={FACE_BENCH} />
      ))}
      <AssetInstances id="bench" matrices={benches.m} ids={benches.ids} />
      <PalletLoads items={pou} hidden={emptyPou} />
      <PartsInstances parts={finished} matrices={finishedSpots.m} ids={finishedSpots.ids} />
    </group>
  )
}
