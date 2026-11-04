import { SERVER_RACK } from '../../layout/constants'
import { GeoBuilder } from './builder'

const { width: W, depth: D, height: H } = SERVER_RACK
const POST = 0.045
const BASE = 0.08
const MOUNT_HALF = 0.465 / 2 + 0.008 // EIA-310 19-in mounting width

/** Open GPU rack frame. Width along X, depth along Z, front at +Z, origin at floor centre. */
export function buildRackFrame(b = new GeoBuilder()): GeoBuilder {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (W / 2 - 0.07)
      const z = sz * (D / 2 - 0.09)
      b.cyl('rubber', 0.035, 0.03, x, 0.035, z, 'x', 14)
      b.box('steelGrey', 0.03, 0.05, 0.06, x, 0.07, z)
      b.box('steelDark', POST, H - BASE, POST, sx * (W / 2 - POST / 2), BASE + (H - BASE) / 2, sz * (D / 2 - POST / 2))
      b.box('zinc', 0.016, H - BASE - 0.12, 0.05, sx * MOUNT_HALF, BASE + (H - BASE) / 2, sz * (D / 2 - 0.12))
    }
  }
  for (const y of [BASE + 0.03, H - 0.03]) {
    for (const s of [-1, 1]) {
      b.box('steelDark', W, 0.06, POST, 0, y, s * (D / 2 - POST / 2))
      b.box('steelDark', POST, 0.06, D - 2 * POST, s * (W / 2 - POST / 2), y, 0)
    }
  }
  for (const y of [0.9, 1.7]) {
    for (const s of [-1, 1]) b.box('steelDark', 0.02, 0.03, D - 2 * POST, s * (W / 2 - POST / 2), y, 0)
  }
  b.box('steelDark', W, 0.012, D, 0, H - 0.006, 0)
  return b
}

/** Front bezel + tray for 1U/2U shelves. */
function shelf(b: GeoBuilder, y: number, units: number, body: 'zinc' | 'batteryGrey', bezel: 'bezelBlack' | 'bezelGrey') {
  const h = 0.0445 * units - 0.004
  b.box(body, 0.44, h, 0.92, 0, y, 0)
  b.box(bezel, 0.482, h, 0.015, 0, y, D / 2 - 0.125)
  b.box('ledGreen', 0.012, 0.006, 0.004, 0.2, y, D / 2 - 0.116)
}

/**
 * What a rack looks like after each station. Quantities per rack come from the BOM (verified);
 * the position of each item inside the rack is illustrative, since no rack drawing was supplied.
 */
export const INSTALL_SEQUENCE: { station: string; items: string }[] = [
  { station: 'WS1', items: 'Base rack, 2 large busbars' },
  { station: 'WS2', items: '2 right + 2 left rails, small busbars' },
  { station: 'WS3', items: '4 battery shelves, 2 top shelves, cable managers' },
  { station: 'WS4', items: 'Battery water pan, 2 adapter plates, 16 M shelves (sub-assembly)' },
  { station: 'WS5', items: '16 T shelves' },
  { station: 'WS6', items: 'Not in photos' },
  { station: 'WS7', items: '2 bottom drain modules, 14 + 14 drain modules' },
  { station: 'WS8', items: '7 center rack cable managers' },
]

export function buildRackAtStage(stage: number): GeoBuilder {
  const b = buildRackFrame()
  const done = (ws: string) => INSTALL_SEQUENCE.findIndex((s) => s.station === ws) <= stage
  const rear = -D / 2 + 0.15

  if (done('WS1')) for (const x of [-0.1, 0.1]) b.box('copper', 0.04, 1.9, 0.01, x, 1.15, rear)
  if (done('WS2')) {
    for (const s of [-1, 1]) {
      b.box('zinc', 0.02, 0.04, D - 0.26, s * 0.235, 0.15, 0)
      b.box('copper', 0.03, 0.6, 0.01, s * 0.2, 0.5, rear)
    }
  }
  if (done('WS3')) {
    for (let i = 0; i < 4; i++) shelf(b, 0.19 + i * 0.092, 2, 'batteryGrey', 'bezelGrey')
    for (let i = 0; i < 2; i++) shelf(b, 2.12 + i * 0.046, 1, 'zinc', 'bezelGrey')
    for (const s of [-1, 1]) {
      const x = s * (W / 2 + 0.04)
      b.box('steelDark', 0.08, 1.95, 0.1, x, 1.17, D / 2 - 0.06)
      for (let k = 0; k < 14; k++) b.box('steelDark', 0.07, 0.012, 0.05, x, 0.3 + k * 0.13, D / 2 + 0.015)
    }
  }
  if (done('WS4')) {
    b.box('steelGrey', 0.5, 0.035, 1.0, 0, 0.115, 0)
    for (const s of [-1, 1]) b.box('zinc', 0.12, 0.01, 0.15, s * 0.16, 0.57, D / 2 - 0.2)
    for (let i = 0; i < 16; i++) shelf(b, 0.62 + i * 0.0465, 1, 'zinc', 'bezelBlack')
  }
  if (done('WS5')) for (let i = 0; i < 16; i++) shelf(b, 1.37 + i * 0.0465, 1, 'zinc', 'bezelGrey')
  if (done('WS7')) {
    for (const s of [-1, 1]) {
      b.box('steelGrey', 0.12, 0.07, 0.06, s * 0.15, 0.13, -D / 2 + 0.05)
      b.cyl('chrome', 0.018, 1.55, s * 0.19, 1.35, -D / 2 + 0.06)
      for (let k = 0; k < 14; k++) b.cyl('copper', 0.008, 0.05, s * 0.19, 0.65 + k * 0.1, -D / 2 + 0.09, 'z', 8)
    }
  }
  if (done('WS8')) for (let k = 0; k < 7; k++) b.box('bezelBlack', 0.48, 0.03, 0.04, 0, 0.45 + k * 0.27, D / 2 - 0.07)
  return b
}

/** A fully assembled rack after WS8: everything installed, plus a green "passed" beacon and tag on top. */
export function buildCompletedRack(): GeoBuilder {
  const b = buildRackAtStage(INSTALL_SEQUENCE.length - 1)
  b.box('steelGrey', 0.1, 0.02, 0.1, 0, H + 0.01, 0)
  b.cyl('ledGreen', 0.04, 0.09, 0, H + 0.065, 0, 'y', 14)
  b.box('ledGreen', 0.3, 0.06, 0.004, 0, H - 0.12, D / 2 + 0.002)
  return b
}

/** Rack carrier on the conveyor: a steel plate with corner locators under the rack's casters. */
export function buildCarrier(): GeoBuilder {
  const b = new GeoBuilder()
  b.box('steelGrey', W + 0.16, 0.04, D + 0.1, 0, -0.02, 0)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('safetyYellow', 0.06, 0.03, 0.06, sx * (W / 2 + 0.03), 0.015, sz * (D / 2 + 0.0))
  return b
}
