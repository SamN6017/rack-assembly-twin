import * as THREE from 'three'

export type MatKey =
  | 'steelDark' | 'steelGrey' | 'zinc' | 'uprightBlue' | 'beamOrange' | 'wood' | 'woodDark'
  | 'cardboard' | 'cardboardDark' | 'wrap' | 'copper' | 'rubber' | 'safetyYellow' | 'benchTop'
  | 'whiteboard' | 'screen' | 'binBlue' | 'binRed' | 'pocketBlue' | 'bezelBlack' | 'bezelGrey'
  | 'batteryGrey' | 'wall' | 'chrome' | 'ledGreen' | 'columnPaint'

const std = (color: string, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })

export const MATERIALS: Record<MatKey, THREE.Material> = {
  steelDark: std('#23262b', 0.55, 0.7),
  steelGrey: std('#7d838a', 0.5, 0.5),
  zinc: std('#c3c8cd', 0.4, 0.6),
  columnPaint: std('#9aa0a6', 0.6, 0.15),
  uprightBlue: std('#1f4f9c', 0.5, 0.4),
  beamOrange: std('#e2661c', 0.5, 0.3),
  wood: std('#b48a5a', 0.85),
  woodDark: std('#8a6640', 0.9),
  cardboard: std('#b8915f', 0.92),
  cardboardDark: std('#9c7748', 0.92),
  wrap: new THREE.MeshPhysicalMaterial({ color: '#dfe8ee', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false }),
  copper: std('#c27a45', 0.3, 0.95),
  rubber: std('#151515', 0.9),
  safetyYellow: std('#f2c218', 0.55, 0.1),
  benchTop: std('#3c4148', 0.7, 0.1),
  whiteboard: std('#f3f4f2', 0.3),
  screen: std('#0b1a2a', 0.2, 0.2, { emissive: '#14324f', emissiveIntensity: 0.6 }),
  binBlue: std('#1d5fb8', 0.6),
  binRed: std('#b8322a', 0.6),
  pocketBlue: std('#24408f', 0.6),
  bezelBlack: std('#111316', 0.5, 0.3),
  bezelGrey: std('#4b5058', 0.5, 0.5),
  batteryGrey: std('#3a3f45', 0.6, 0.4),
  wall: std('#c9cbc6', 0.95),
  chrome: std('#d9dde1', 0.2, 1),
  ledGreen: std('#38d16a', 0.4, 0, { emissive: '#38d16a', emissiveIntensity: 1.5 }),
}

/** Procedural polished-concrete texture with saw-cut joints every `jointEvery` metres. */
export function makeConcreteTexture(metresPerTile: number, jointEvery: number): THREE.CanvasTexture {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#8d9093'
  ctx.fillRect(0, 0, size, size)
  // Seeded noise so the floor looks the same on every load.
  let seed = 1337
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 26000; i++) {
    const v = 120 + rnd() * 50
    ctx.fillStyle = `rgba(${v},${v + 2},${v + 4},${0.05 + rnd() * 0.12})`
    const r = 1 + rnd() * 6
    ctx.fillRect(rnd() * size, rnd() * size, r, r)
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(60,60,60,${0.03 + rnd() * 0.04})`
    ctx.beginPath()
    ctx.ellipse(rnd() * size, rnd() * size, 40 + rnd() * 140, 30 + rnd() * 90, rnd() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = 'rgba(40,40,40,0.55)'
  ctx.lineWidth = 2
  const step = (size * jointEvery) / metresPerTile
  for (let p = 0; p <= size; p += step) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}
