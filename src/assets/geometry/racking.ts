import { RACKING } from '../../layout/constants'
import { GeoBuilder, v3 } from './builder'

const { depth: DEPTH, bayWidth: BAY, height: HEIGHT, levels: LEVELS } = RACKING
const POST = 0.076

/** Upright frame: two posts with zig-zag bracing. Depth along X, origin at floor centre. */
export function buildUprightFrame(): GeoBuilder {
  const b = new GeoBuilder()
  const px = DEPTH / 2 - POST / 2
  for (const s of [-1, 1]) {
    b.box('uprightBlue', POST, HEIGHT, POST, s * px, HEIGHT / 2, 0)
    b.box('steelGrey', 0.14, 0.01, 0.14, s * px, 0.005, 0)
  }
  const step = 0.9
  for (let y = 0.15, i = 0; y + step < HEIGHT; y += step, i++) {
    const a = i % 2 ? -px : px
    b.bar('uprightBlue', 0.03, v3(a, y, 0), v3(-a, y + step, 0))
  }
  b.bar('uprightBlue', 0.03, v3(-px, 0.15, 0), v3(px, 0.15, 0))
  return b
}

/** Beams and wire decks for one bay. Bay runs along Z, depth along X. */
export function buildRackingBay(): GeoBuilder {
  const b = new GeoBuilder()
  for (const y of LEVELS.slice(1)) {
    for (const s of [-1, 1]) b.box('beamOrange', 0.05, 0.12, BAY - POST, s * (DEPTH / 2 - 0.04), y - 0.06, 0)
    b.box('zinc', DEPTH - 0.1, 0.012, BAY - 0.12, 0, y + 0.006, 0)
  }
  return b
}
