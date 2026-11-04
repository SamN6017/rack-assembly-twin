import { useMemo } from 'react'
import type { AssetId } from '../assets/manifest'
import { AssetInstances, mat4 } from './Instanced'
import { equipmentByAsset } from './entities'

// Pallet jacks are live material handlers now (see Handlers.tsx).
const TYPES: AssetId[] = ['kanbanBoard', 'twoBinShelving', 'cart']

/** Kanban board, small-parts 2-bin shelving and spare carts. */
export function Equipment() {
  const groups = useMemo(() => TYPES.map((assetId) => {
    const list = equipmentByAsset(assetId)
    return { assetId, m: list.map((e) => mat4(e.at.x, 0, e.at.z, e.rotY)), ids: list.map((e) => e.id) }
  }), [])
  return <group>{groups.map((g) => <AssetInstances key={g.assetId} id={g.assetId} matrices={g.m} ids={g.ids} />)}</group>
}
