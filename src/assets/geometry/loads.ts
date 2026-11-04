import { PALLET, SERVER_RACK } from '../../layout/constants'
import { GeoBuilder } from './builder'
import { buildRackFrame } from './serverRack'

const W = PALLET.width - 0.02
const L = PALLET.length - 0.02

/** Stretch-wrapped carton stack, 1 m tall, sitting at y = 0. Scale Y per instance for real height. */
export function buildCartonStack(): GeoBuilder {
  const b = new GeoBuilder()
  const layers = 3
  const h = 1 / layers
  const g = 0.008
  for (let l = 0; l < layers; l++) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.box(l % 2 ? 'cardboardDark' : 'cardboard', W / 2 - g, h - g, L / 2 - g, (sx * W) / 4, l * h + h / 2, (sz * L) / 4)
      }
    }
  }
  b.box('wrap', W + 0.012, 1.0, L + 0.012, 0, 0.5, 0)
  return b
}

/** Plywood crate with battens, 1 m tall, sitting at y = 0. Scale Y per instance. */
export function buildCrate(): GeoBuilder {
  const b = new GeoBuilder()
  b.box('wood', W - 0.04, 0.98, L - 0.04, 0, 0.49, 0)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('woodDark', 0.05, 1.0, 0.05, (sx * (W - 0.05)) / 2, 0.5, (sz * (L - 0.05)) / 2)
  for (const y of [0.04, 0.96]) {
    for (const s of [-1, 1]) {
      b.box('woodDark', W, 0.06, 0.03, 0, y, (s * (L - 0.03)) / 2)
      b.box('woodDark', 0.03, 0.06, L, (s * (W - 0.03)) / 2, y, 0)
    }
  }
  return b
}

/** Empty rack frame shrink-wrapped to its pallet, as received from the supplier. Sits at y = 0. */
export function buildWrappedRack(): GeoBuilder {
  const b = buildRackFrame()
  b.box('wrap', SERVER_RACK.width + 0.03, SERVER_RACK.height, SERVER_RACK.depth + 0.03, 0, SERVER_RACK.height / 2, 0)
  return b
}
