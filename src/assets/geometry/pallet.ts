import { PALLET } from '../../layout/constants'
import { GeoBuilder } from './builder'

/** GMA 48 x 40 in stringer pallet. Width along X, length along Z, origin at floor centre. */
export function buildPallet(): GeoBuilder {
  const { width: W, length: L, height: H } = PALLET
  const deck = 0.019
  const stringer = H - 2 * deck
  const b = new GeoBuilder()
  for (const x of [-W / 2 + 0.019, 0, W / 2 - 0.019]) b.box('wood', 0.038, stringer, L, x, deck + stringer / 2, 0)
  const boards = 7
  const bw = 0.14
  for (let i = 0; i < boards; i++) {
    const z = -L / 2 + bw / 2 + (i * (L - bw)) / (boards - 1)
    b.box(i === 0 || i === boards - 1 ? 'woodDark' : 'wood', W, deck, bw, 0, H - deck / 2, z)
  }
  for (const z of [-L / 2 + bw / 2, 0, L / 2 - bw / 2]) b.box('woodDark', W, deck, bw, 0, deck / 2, z)
  return b
}
