import { useMemo } from 'react'
import * as THREE from 'three'
import { getPart, KANBAN_PARTS } from '../data/parts'
import { loadProfile } from '../assets/manifest'
import { MATERIALS } from '../assets/materials'
import { LAYOUT } from '../layout/factoryLayout'
import { useSim } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { PalletLoads, type PalletLoad } from './Instanced'
import { partSignTexture } from './labelTexture'

const SIGN_W = 1.5
const SIGN_H = (SIGN_W * 176) / 512
const SIGN_Y = 4.6
const CEILING_Y = 9.5

/**
 * Kanban storage: one-deep rows facing pick aisles. Every Kanban starts full (slide P1: "all Kanbans
 * will be full for production"); pallets then leave and return as the simulation picks and refills.
 * Pallet counts per Kanban are verified; load shapes and heights are estimated.
 */
export function KanbanArea() {
  const showSigns = useUi((s) => s.layers.signs)
  const counts = useSim((s) => s.snapshot.kanban)

  const loads = useMemo<PalletLoad[]>(
    () => LAYOUT.slots.flatMap((slot) => {
      const profile = loadProfile(getPart(slot.pn))
      return slot.pallets.map((p, i) => ({ ...p, profile, id: `kanban:${slot.id}:${i}` }))
    }),
    [],
  )

  // Pallets are picked from the top index down and refilled from index 0 up, so a Kanban with
  // n pallets present shows positions 0..n-1.
  const hidden = useMemo(() => {
    const out = new Set<string>()
    for (const slot of LAYOUT.slots) {
      const n = counts.get(slot.id) ?? slot.pallets.length
      for (let i = n; i < slot.pallets.length; i++) out.add(`kanban:${slot.id}:${i}`)
    }
    return out
  }, [counts])

  // One hanging sign per part over its Kanbans, readable from both directions along the aisle.
  const signs = useMemo(() => KANBAN_PARTS.map((part) => {
    const slots = LAYOUT.slots.filter((s) => s.pn === part.pn)
    const same = slots.every((s) => s.aisleId === slots[0].aisleId && s.side === slots[0].side)
    const use = same ? slots : [slots[0]]
    const minX = Math.min(...use.map((s) => s.rect.minX))
    const maxX = Math.max(...use.map((s) => s.rect.maxX))
    return { part, x: (minX + maxX) / 2, z: (slots[0].rect.minZ + slots[0].rect.maxZ) / 2, tex: partSignTexture(part) }
  }), [])

  // Floor part numbers in the aisle, in front of each Kanban (slide P3).
  const floorLabels = useMemo(() => LAYOUT.slots.map((slot) => {
    const width = Math.min(slot.rect.maxX - slot.rect.minX - 0.12, 1.2)
    const z = slot.side === 'N' ? slot.rect.maxZ + 0.3 : slot.rect.minZ - 0.3
    return { slot, width, z, tex: partSignTexture(getPart(slot.pn)) }
  }), [])

  return (
    <group>
      <PalletLoads items={loads} hidden={hidden} />
      {floorLabels.map(({ slot, width, z, tex }) => (
        <mesh key={slot.id} position={[(slot.rect.minX + slot.rect.maxX) / 2, 0.006, z]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[width, (width * 176) / 512]} />
          <meshStandardMaterial map={tex} roughness={0.8} polygonOffset polygonOffsetFactor={-3} />
        </mesh>
      ))}
      {showSigns && signs.map(({ part, x, z, tex }) => (
        <group key={part.pn} position={[x, SIGN_Y, z]}>
          {[0, Math.PI].map((r) => (
            <mesh key={r} rotation-y={r} position={[0, 0, r ? -0.006 : 0.006]}>
              <planeGeometry args={[SIGN_W, SIGN_H]} />
              <meshStandardMaterial map={tex} roughness={0.6} side={THREE.FrontSide} />
            </mesh>
          ))}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * SIGN_W * 0.4, (CEILING_Y - SIGN_Y) / 2 + SIGN_H / 2, 0]} material={MATERIALS.steelGrey}>
              <cylinderGeometry args={[0.006, 0.006, CEILING_Y - SIGN_Y - SIGN_H / 2, 4]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}
