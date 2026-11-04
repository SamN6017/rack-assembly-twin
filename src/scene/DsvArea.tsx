import { useMemo } from 'react'
import { RACKING } from '../layout/constants'
import { LAYOUT } from '../layout/factoryLayout'
import { DSV_STOCK } from './entities'
import { AssetInstances, PalletLoads, mat4, type PalletLoad } from './Instanced'

/**
 * DSV warehouse racking and staging lane. ILLUSTRATIVE: the photos show high-bay racking but no
 * warehouse layout or stock levels, so bay count and fill are generated, not data.
 */
export function DsvArea() {
  const { frames, bays, stock } = useMemo(() => {
    const bays = LAYOUT.rackingBays.map((b) => mat4(b.x, 0, b.z, 0))

    const frameKeys = new Set<string>()
    const frames = []
    for (const b of LAYOUT.rackingBays) {
      for (const dz of [-RACKING.bayWidth / 2, RACKING.bayWidth / 2]) {
        const key = `${b.x.toFixed(2)}:${(b.z + dz).toFixed(2)}`
        if (frameKeys.has(key)) continue
        frameKeys.add(key)
        frames.push(mat4(b.x, 0, b.z + dz, 0))
      }
    }

    const stock: PalletLoad[] = DSV_STOCK.map((p, i) => ({ ...p, rotY: Math.PI / 2, id: `dsv:${i}` }))
    return { frames, bays, stock }
  }, [])

  return (
    <group>
      <AssetInstances id="uprightFrame" matrices={frames} />
      <AssetInstances id="rackingBay" matrices={bays} />
      <PalletLoads items={stock} />
    </group>
  )
}
