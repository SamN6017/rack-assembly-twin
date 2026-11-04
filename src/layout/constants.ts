/**
 * Every physical dimension the layout depends on. Units: metres.
 * Axes: +X = right on the P1 slide, +Z = down the slide, +Y = up.
 * Unless a comment says otherwise these are ESTIMATES: no floor plan has been supplied.
 */

// GMA 48 x 40 in stringer pallet (North American standard). Estimated: pallet type not stated.
// Forks enter along the 48 in length, so a pallet is always oriented with its length along the
// direction the pallet jack approaches from.
export const PALLET = { width: 1.016, length: 1.219, height: 0.133 }

// Kanban rows are ONE pallet deep, pallets side by side facing a pick aisle (slide P5: "placing
// pallets next to each other instead of behind one another to allow quicker access"). Pitch along
// the row leaves ~6 cm between pallets.
export const ROW_PITCH = 1.08
export const ROW_SETBACK = 0.1      // gap between pallet face and aisle edge
export const PICK_AISLE = 3.2       // pallet-jack aisle between facing rows
export const BACK_GAP = 0.3         // between back-to-back rows of neighbouring aisles
export const ROW_CAPACITY = 22      // pallets per row side (= largest Kanban, 22 pallets)

export const BUILDING = { minX: -46, maxX: 66, minZ: -10, maxZ: 72, wallHeight: 10, columnPitchX: 12, columnPitchZ: 15 }

export const ZONES = {
  dsvRacking: { minX: -42, maxX: -9, minZ: 2, maxZ: 46 },
  dsvStaging: { minX: -8, maxX: -3.5, minZ: 2, maxZ: 24 },
  kanban: { minX: 0, maxX: 25, minZ: 2 },
  handlerFloor: { minX: 28, maxX: 42, minZ: 0, maxZ: 68 },
  finishedStaging: { minX: 44, maxX: 62, minZ: -8, maxZ: -1 },
  mainAisle: { minX: 56, maxX: 60, minZ: -1, maxZ: 70 },
}

export const AISLES = {
  dsvDrop: { minX: -3.5, maxX: 0 },   // DSV side of the Kanban area
  clsPick: { minX: 25, maxX: 28 },    // CLS side of the Kanban area
}

export const LINE = {
  rackX: 51,          // centreline of racks on the line
  pouX: 46.6,         // POU pallet column (aisle side, as on P1); one pallet deep so each is reachable
  firstStationZ: 4,
  stationPitch: 8.2,  // fits the 6 POU pallets at WS2 / WS3 in one column
  benchOffsetX: 2.0,  // bench sits on the main-aisle side of each rack
}

// Handler corridors (centrelines). Estimated, chosen to clear storage and equipment.
export const ROUTES = {
  dsvAisleX: -1.75,
  clsAisleX: 26.5,
  spineX: 34.5,
  pouLaneX: 43.4,   // far enough from the POU column that a handler parked at a POU spot leaves the lane clear
  topZ: 0.9,
}

// DSV staging lane: prepared replenishment pallets wait here for the DSV handler.
export const STAGING = { x: -5.75, firstZ: 3.5, pitch: 1.6, slots: 10 }

// Selective pallet racking typical of DSV warehouses. Illustrative.
export const RACKING = { bayWidth: 2.74, depth: 1.07, levels: [0, 1.7, 3.4, 5.1], height: 6.4, rowGap: 3.6 }

// Rack under assembly. Typical GPU rack footprint; NOT from evidence.
export const SERVER_RACK = { width: 0.6, depth: 1.2, height: 2.286 }
