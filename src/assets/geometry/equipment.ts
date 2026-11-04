import * as THREE from 'three'
import { BUILDING } from '../../layout/constants'
import { GeoBuilder, v3 } from './builder'

/** Assembly bench, 1.8 m along Z. Pegboard back at +X. Origin at floor centre. */
export function buildBench(): GeoBuilder {
  const b = new GeoBuilder()
  const L = 1.8
  const D = 0.75
  b.box('benchTop', D, 0.04, L, 0, 0.9, 0)
  b.box('steelGrey', D - 0.06, 0.02, L - 0.1, 0, 0.18, 0)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('steelGrey', 0.04, 0.88, 0.04, sx * (D / 2 - 0.04), 0.44, sz * (L / 2 - 0.04))
  for (const sz of [-1, 1]) b.box('steelGrey', 0.04, 1.0, 0.04, D / 2 - 0.04, 1.4, sz * (L / 2 - 0.04))
  b.box('steelGrey', 0.015, 0.8, L - 0.1, D / 2 - 0.04, 1.4, 0)
  b.box('safetyYellow', 0.06, 0.04, L, D / 2 - 0.06, 1.88, 0)
  b.cyl('steelDark', 0.012, 0.35, D / 2 - 0.12, 1.1, -0.4)
  b.box('screen', 0.03, 0.32, 0.52, D / 2 - 0.18, 1.32, -0.4)
  return b
}

/** Manual pallet jack, 27 x 48 in forks along Z, handle at +Z. */
export function buildPalletJack(): GeoBuilder {
  const b = new GeoBuilder()
  for (const s of [-1, 1]) {
    b.box('safetyYellow', 0.16, 0.055, 1.15, s * 0.265, 0.06, 0)
    b.cyl('rubber', 0.035, 0.07, s * 0.265, 0.035, -0.5, 'x')
  }
  b.box('safetyYellow', 0.69, 0.12, 0.18, 0, 0.1, 0.63)
  b.cyl('steelDark', 0.06, 0.32, 0, 0.32, 0.7)
  for (const s of [-1, 1]) b.cyl('rubber', 0.09, 0.05, s * 0.09, 0.09, 0.72, 'x', 16)
  b.bar('steelDark', 0.035, v3(0, 0.45, 0.72), v3(0, 1.15, 0.98))
  b.box('rubber', 0.3, 0.04, 0.04, 0, 1.17, 0.99)
  return b
}

/** Four-caster platform cart with push handle at +Z. */
export function buildCart(): GeoBuilder {
  const b = new GeoBuilder()
  const W = 0.8
  const L = 1.4
  b.box('steelGrey', W, 0.04, L, 0, 0.28, 0)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl('rubber', 0.075, 0.05, sx * (W / 2 - 0.08), 0.075, sz * (L / 2 - 0.1), 'x', 16)
      b.box('steelDark', 0.05, 0.12, 0.05, sx * (W / 2 - 0.08), 0.2, sz * (L / 2 - 0.1))
    }
    b.cyl('zinc', 0.015, 0.75, sx * (W / 2 - 0.02), 0.67, L / 2 - 0.02)
  }
  b.cyl('rubber', 0.02, W, 0, 1.03, L / 2 - 0.02, 'x')
  return b
}

/** Chrome wire shelving with two-bin small-parts bins (front + back bin per part). Width along X. */
export function buildTwoBinShelving(): GeoBuilder {
  const b = new GeoBuilder()
  const W = 1.8
  const D = 0.6
  const H = 1.9
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl('chrome', 0.013, H, sx * (W / 2 - 0.013), H / 2, sz * (D / 2 - 0.013))
  const shelves = [0.15, 0.6, 1.05, 1.5]
  for (const y of shelves) {
    b.box('chrome', W, 0.008, D, 0, y, 0)
    for (const s of [-1, 1]) b.cyl('chrome', 0.006, W, 0, y + 0.02, s * (D / 2 - 0.006), 'x', 6)
  }
  const binW = 0.2
  const binD = 0.28
  const binH = 0.15
  const wall = 0.006
  for (const y of shelves.slice(1)) {
    for (let i = 0; i < 8; i++) {
      for (const [k, sz] of [[0, 1], [1, -1]] as const) {
        const x = -W / 2 + 0.11 + i * 0.22
        const z = (sz * binD) / 2 + sz * 0.01
        const mat = k === 0 ? 'binBlue' : 'binRed'
        b.box(mat, binW, wall, binD, x, y + 0.008 + wall / 2, z)
        b.box(mat, wall, binH, binD, x - binW / 2, y + binH / 2, z)
        b.box(mat, wall, binH, binD, x + binW / 2, y + binH / 2, z)
        b.box(mat, binW, binH * 0.6, wall, x, y + binH * 0.3, z + (sz * binD) / 2)
        b.box(mat, binW, binH, wall, x, y + binH / 2, z - (sz * binD) / 2)
        if (k === 0) b.box('whiteboard', 0.1, 0.04, 0.002, x, y + 0.06, z + binD / 2 + 0.004)
      }
    }
  }
  return b
}

/** Physical Kanban board (slide P2): 12 card pockets on the 'today' row, 7 on the calendar row. Faces -X. */
export function buildKanbanBoard(): GeoBuilder {
  const b = new GeoBuilder()
  const L = 3.6
  b.box('whiteboard', 0.03, 1.3, L, 0, 1.45, 0)
  b.box('steelGrey', 0.05, 0.04, L + 0.05, 0, 2.11, 0)
  b.box('steelGrey', 0.05, 0.04, L + 0.05, 0, 0.79, 0)
  for (const s of [-1, 1]) {
    b.box('steelGrey', 0.05, 2.15, 0.05, 0, 1.075, s * (L / 2 + 0.02))
    b.box('steelGrey', 0.6, 0.03, 0.06, 0, 0.015, s * (L / 2 + 0.02))
  }
  b.box('steelDark', 0.004, 0.012, L - 0.1, -0.02, 1.32, 0)
  const pocket = new THREE.Shape()
  pocket.moveTo(-0.09, 0)
  pocket.lineTo(0.09, 0)
  pocket.lineTo(0.09, 0.15)
  pocket.lineTo(0, 0.22)
  pocket.lineTo(-0.09, 0.15)
  pocket.closePath()
  const addPocket = (z: number, y: number) => {
    const g = new THREE.ExtrudeGeometry(pocket, { depth: 0.025, bevelEnabled: false })
    g.rotateY(-Math.PI / 2)
    g.translate(-0.016, y, z)
    b.add('pocketBlue', g)
  }
  for (let i = 0; i < 12; i++) addPocket(-L / 2 + 0.2 + (i * (L - 0.4)) / 11, 1.5)
  for (let i = 0; i < 7; i++) addPocket(-L / 2 + 0.25 + (i * (L - 0.5)) / 6, 0.95)
  return b
}

/** Steel W-section building column with a yellow guard. */
export function buildColumn(): GeoBuilder {
  const b = new GeoBuilder()
  const H = BUILDING.wallHeight
  for (const s of [-1, 1]) b.box('columnPaint', 0.3, H, 0.02, 0, H / 2, s * 0.14)
  b.box('columnPaint', 0.014, H, 0.28, 0, H / 2, 0)
  b.cyl('safetyYellow', 0.27, 1.2, 0, 0.6, 0, 'y', 20)
  return b
}
