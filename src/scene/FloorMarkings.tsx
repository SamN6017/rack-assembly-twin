import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALLET } from '../layout/constants'
import { LAYOUT, type Rect } from '../layout/factoryLayout'

type Tape = 'yellow' | 'blue' | 'white' | 'green'

const TAPE: Record<Tape, THREE.MeshStandardMaterial> = {
  yellow: new THREE.MeshStandardMaterial({ color: '#e8b81a', roughness: 0.7 }),
  blue: new THREE.MeshStandardMaterial({ color: '#1f5fd1', roughness: 0.7 }),
  white: new THREE.MeshStandardMaterial({ color: '#e9ecee', roughness: 0.7 }),
  green: new THREE.MeshStandardMaterial({ color: '#3fae55', roughness: 0.7 }),
}
for (const m of Object.values(TAPE)) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -2 })

const Y = 0.003

function strip(x0: number, z0: number, x1: number, z1: number, w: number): THREE.BufferGeometry {
  const len = Math.hypot(x1 - x0, z1 - z0)
  const g = new THREE.PlaneGeometry(len, w)
  g.rotateX(-Math.PI / 2)
  g.rotateY(-Math.atan2(z1 - z0, x1 - x0))
  g.translate((x0 + x1) / 2, Y, (z0 + z1) / 2)
  return g
}

function outline(r: Rect, w: number): THREE.BufferGeometry[] {
  return [
    strip(r.minX, r.minZ, r.maxX, r.minZ, w), strip(r.minX, r.maxZ, r.maxX, r.maxZ, w),
    strip(r.minX, r.minZ, r.minX, r.maxZ, w), strip(r.maxX, r.minZ, r.maxX, r.maxZ, w),
  ]
}

function dashed(x0: number, z0: number, x1: number, z1: number, w: number, dash = 1, gap = 0.8): THREE.BufferGeometry[] {
  const len = Math.hypot(x1 - x0, z1 - z0)
  const out: THREE.BufferGeometry[] = []
  for (let s = 0; s < len; s += dash + gap) {
    const e = Math.min(s + dash, len)
    out.push(strip(x0 + ((x1 - x0) * s) / len, z0 + ((z1 - z0) * s) / len, x0 + ((x1 - x0) * e) / len, z0 + ((z1 - z0) * e) / len, w))
  }
  return out
}

/** Floor square for a pallet lying with its length along X (POU, staging). */
const palletOutlineX = (x: number, z: number) =>
  outline({ minX: x - PALLET.length / 2 - 0.05, maxX: x + PALLET.length / 2 + 0.05, minZ: z - PALLET.width / 2 - 0.05, maxZ: z + PALLET.width / 2 + 0.05 }, 0.04)

/** Floor tape: Kanban 'Blue Box', slot outlines, aisles, POU squares, staging, handler walkway. */
export function FloorMarkings() {
  const meshes = useMemo(() => {
    const L = LAYOUT
    const t: Record<Tape, THREE.BufferGeometry[]> = { yellow: [], blue: [], white: [], green: [] }

    t.blue.push(...outline({ ...L.kanbanArea, minX: L.kanbanArea.minX - 0.15, maxX: L.kanbanArea.maxX + 0.15, minZ: L.kanbanArea.minZ - 0.15, maxZ: L.kanbanArea.maxZ + 0.15 }, 0.15))
    for (const s of L.slots) t.white.push(...outline(s.rect, 0.05))
    for (const r of [L.middleAisle, L.zones.dsvDrop, L.zones.clsPick]) {
      t.yellow.push(strip(r.minX, r.minZ, r.maxX, r.minZ, 0.1), strip(r.minX, r.maxZ, r.maxX, r.maxZ, 0.1))
    }
    for (const r of [L.zones.dsvDrop, L.zones.clsPick]) t.yellow.push(...dashed((r.minX + r.maxX) / 2, r.minZ, (r.minX + r.maxX) / 2, r.maxZ, 0.08))

    const ma = L.zones.mainAisle
    t.yellow.push(strip(ma.minX, ma.minZ, ma.minX, ma.maxZ, 0.1), strip(ma.maxX, ma.minZ, ma.maxX, ma.maxZ, 0.1))
    t.yellow.push(...dashed((ma.minX + ma.maxX) / 2, ma.minZ, (ma.minX + ma.maxX) / 2, ma.maxZ, 0.08, 1.5, 1))

    const hf = L.zones.handlerFloor
    t.green.push(strip(hf.minX, hf.minZ, hf.minX, hf.maxZ, 0.1), strip(hf.maxX, hf.minZ, hf.maxX, hf.maxZ, 0.1))

    t.green.push(...outline(L.zones.finishedStaging, 0.12))
    for (const p of L.finishedRackSpots) t.green.push(...outline({ minX: p.x - 0.7, maxX: p.x + 0.7, minZ: p.z - 0.4, maxZ: p.z + 0.4 }, 0.04))

    t.yellow.push(...outline(L.zones.dsvStaging, 0.1))
    for (const p of L.stagingSlots) t.white.push(...palletOutlineX(p.x, p.z))
    for (const p of L.parkingSpots) {
      const dz = Math.sign(p.z - p.junction.z)
      const [w, d] = p.role === 'CLS' ? [1.0, 2.4] : [2.4, 1.0]
      const cx = p.role === 'CLS' ? p.x : p.x + 0.55
      const cz = p.role === 'CLS' ? p.z - dz * 0.55 : p.z
      t.green.push(...outline({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 }, 0.06))
    }
    for (const st of L.stations) {
      for (const p of st.pou) t.yellow.push(...palletOutlineX(p.x, p.z))
      t.white.push(...outline({ minX: st.rack.x - 0.8, maxX: st.rack.x + 0.8, minZ: st.rack.z - 0.5, maxZ: st.rack.z + 0.5 }, 0.04))
    }
    return (Object.keys(t) as Tape[]).filter((k) => t[k].length).map((k) => ({ key: k, geometry: mergeGeometries(t[k])! }))
  }, [])

  return <>{meshes.map((m) => <mesh key={m.key} geometry={m.geometry} material={TAPE[m.key]} receiveShadow />)}</>
}
