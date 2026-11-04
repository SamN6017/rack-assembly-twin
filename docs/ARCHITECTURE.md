# Rack Assembly Digital Twin — Version 1 Plan

## 1. Repository assessment

The folder contained no application code, only reference material. Nothing to migrate, so V1 uses the
preferred stack: Vite + React 19 + TypeScript, Three.js via React Three Fiber + Drei, Zustand, Tailwind CSS,
Recharts (Milestone 6), Vitest. shadcn/ui is deferred until the forms in Milestone 5 need it.

| Path | What it is |
|---|---|
| `source/photos-2026-10-14/` | 10 photos of the Kanban slides and the Material Replenishment sheet |
| `data/factory-extraction.json` | Structured extraction with verified / estimated / placeholder flags |
| `docs/ARCHITECTURE.md` | This document |

## 2. Extracted requirements (summary)

Full detail and per-value confidence live in `data/factory-extraction.json`.

- **Verified:** 96 racks/day over 18 h (5.33/h; slide baseline 5/h); 2 Kanbans per part; 2 h lead time and
  2 h safety stock; 1 pallet at point of use; 29 pallet-Kanban part numbers with qty/rack, qty/pallet,
  Kanban size; WS1–WS5, SUBASSY, WS7, WS8 content; Kanban board structure; small parts on 2-bin.
- **Estimated:** line shape (one vertical line, ~10 stations), main aisle on the right, part-number digits
  other than 1225629 / 1230914, shipping-bracket rows.
- **Placeholder:** cycle times, WS6, handler count/speed/capacity, floor dimensions, part dimensions.

## 3. Architecture

```
                 data/factory-extraction.json
                              │
                   src/data (typed parts, workstations)
                              │
         ┌────────────────────┼─────────────────────┐
         ▼                    ▼                     ▼
  src/layout             src/sim (M4–M5)       src/assets
  pure functions:        deterministic DES:    manifest + procedural
  zones, Kanban slots,   clock, event queue,   geometry builders
  stations, POU,         inventory, Kanban     (GLB when supplied,
  aisles, route graph    state machine         fallback otherwise)
         │                    │                     │
         └──────────┬─────────┴──────────┬──────────┘
                    ▼                    ▼
             src/store (Zustand)   src/scene (R3F) ── reads layout + sim
                    │                    snapshot, never mutates sim
                    ▼
               src/ui (panels, nav, charts)
```

Rules:
- `src/layout` and `src/sim` import nothing from React or Three. They are unit-tested in Node.
- The simulation clock is authoritative; the scene only interpolates between sim states (M3+).
- Every scene object that represents data carries an id that maps back to a part, slot or station.

## 4. Proposed factory layout (V1, estimated)

Follows the P1 slide: Kanban "Blue Box" on the left, handler routes looping right, one vertical line
with POU pallets on its aisle side, main aisle on the far right, staging box top right.
Units are metres; +X is right on the slide, +Z is down the slide.

```
 z
 0 ┌──────────────┐ ┌────────────┐           ┌───────────────────────┐
   │ DSV prep /   │ │  KANBAN    │  handler  │ finished-rack staging │
   │ pallet racks │ │ "Blue Box" │  route    └───────────────────────┘
   │              │ │ 17 lanes,  │ ───────▶  POU  WS   main
   │              │ │ 2 kanbans  │           pal  ▣    aisle
   │              │ │ per part   │ ◀───────  pal  ▣    │
   │              │ │            │           ...  ...  │
   └──────────────┘ └────────────┘                     │
 x  -40            -2           24          44  50     58
```

Dimensions that come from evidence: pallet count per Kanban (sheet), lane order (slide), station order
(sheet). Everything else (building size, aisle widths, station pitch) is an estimate and is defined in one
place, `src/layout/constants.ts`, so it can be corrected when a floor plan is supplied.

## 5. 3D asset inventory

No CAD or GLB files were supplied. Each asset therefore has a procedural model built from real-world
proportions, flagged `procedural-approximate`. A GLB dropped into `public/models/` and listed in the
manifest replaces it without code changes.

| Asset | Basis for dimensions | Confidence |
|---|---|---|
| Pallet (GMA 48×40 in) | North American standard | estimated |
| Server rack frame (600 × 1200 × 2286 mm, 48U) | Typical GPU rack, not from evidence | estimated |
| Carton loads per part | Pallet height only | estimated |
| Pallet racking (DSV area) | Photos show selective racking, sizes typical | estimated |
| 2-bin wire shelving + bins | Slide P4 photo | estimated |
| Workstation bench | Not shown in detail | placeholder |
| Pallet jack, tugger cart | Typical equipment | estimated |
| Kanban board | Slide P2 photo, 12 + 7 pockets | estimated |
| Hanging part-number signs | Slide P3 | verified (concept) |

## 6. Simulation data model (implemented in M4–M5)

```ts
Part        { pn, description, models[], workstation, qtyPerRack, qtyPerPallet, kanbanPallets, confidence }
KanbanCard  { id, pn, index(0|1), status, slotId, emptyAt?, requestedAt?, dueAt?, deliveredAt? }
Inventory   { pn, kanbanQty, pouQty, inTransitQty, consumedQty }        // pieces, conserved
Handler     { id, state, routeNodes[], load?, utilisationSec }
Event       { t, seq, type, payload }   // min-heap on (t, seq) for determinism
```
Inventory transfer points: reserve on HANDLER_DISPATCHED (Kanban → in transit), add on MATERIAL_DELIVERED
(in transit → POU), remove on MATERIAL_CONSUMED (POU → consumed). Nothing else changes quantities.

## 7. Milestone 3 notes: movement

- **Kanban area re-laid out** as one-deep rows facing pick aisles (slide P5: pallets "next to each
  other instead of behind one another"). Every pallet has its own pick face, so no pallet is ever
  reached through another. Rows are filled first-fit in P1 map order.
- **Routes**: handlers drive only on corridor centrelines (`LAYOUT.corridors`) and short straight
  spurs into a pallet position. `src/sim/routeGraph.ts` builds the graph; tests check every corridor
  and spur against storage, equipment, columns and walls, and every junction for room to turn.
- **Motion**: paths have 1 m corner fillets; speed follows a trapezoidal profile (accelerate, cruise,
  decelerate). Handlers stop at a spur, turn on the spot and push forks-first into the position, then
  back out. Pose is a pure function of simulation time (`src/sim/timeline.ts`), so pause, playback
  speed and reset cannot desynchronise animation.
- **Occupancy**: each new trip is checked against every committed trip; if footprints would come
  closer than 0.15 m, departure is delayed in 2 s steps. Every trip ends with the handler back in its
  own bay, so an idle handler never blocks a corridor.
- **Demand feed (interim)**: POU pallets are consumed at the BOM rate (baseline 5 racks/h, 50/50
  model mix as a placeholder). An empty POU raises a CLS delivery from the part's in-use Kanban; an
  empty Kanban is staged by DSV after a placeholder 45 min prep and refilled by the DSV handler.
  Inventory is pallet-level. Milestones 4–5 replace this with piece-level stock, the Kanban card
  lifecycle, inspection intervals and production blocking, using the same movement engine.

## 8. Milestone 4 notes: piece-level inventory and Kanban cards

- **Consumption**: the line pulls one rack per takt (3600 / rate s). Each rack is Yawn or Bloom
  (seeded, 50/50 placeholder mix) and takes its BOM quantity of every tracked pallet part at that
  part's station; rack r reaches line step k at (r + k) × takt, so the line is full at shift start.
  Sub-assembly works in step with WS4. Cycle times are unknown, so the takt stands in for them.
- **Stock in pieces**: Kanban pieces = pallets × qty/pallet; POU stock is counted piece by piece.
  A POU raises a CLS delivery as soon as it cannot cover the next rack; the delivered pallet tops it
  up. Parts without BOM or pallet quantity (the three shipping brackets) are not simulated.
- **Starvation**: a rack that reaches a station short is logged as a backorder and starvation
  interval, closed when the next pallet arrives. The line keeps moving; blocking is Milestone 5.
- **Card lifecycle**: FULL → IN USE → EMPTY (last pallet leaves; card goes on the board) →
  REQUESTED (DSV collects cards at each board inspection, every 60 min, slide P1: 1–2 h) →
  PREPARING (placeholder 45 min, 2 prep teams) → IN TRANSIT (first staged pallet picked) →
  REPLENISHED (Kanban full again) → FULL when DSV files the card at the next inspection.
  Due = emptied + 2 h lead time; a refill after that is a late delivery (logged for RCCA, slide P2).
- **Board and overlays**: the Kanban Board tab shows one card per Kanban in a column per state,
  cross-linked with the 3D selection. The inventory overlay tints Kanban slots by card state and
  shows a fill gauge at every POU.
- **Default-run finding (placeholder-driven)**: 50 racks, 0 starvations, but 5 of 11 closed card
  cycles miss the 2 h lead time. The single DSV handler refilling 22-pallet Kanbans one pallet at a
  time is the bottleneck. Treat this as a question for DSV, not a result, until handler count,
  speeds and prep time are confirmed.

## 9. Milestone 5 notes: scenario controls and production blocking

- **Paced line**: every takt all stations index together; station step k works on rack j − k at
  index j. Before indexing, every station checks it holds the BOM pieces for its rack. If any POU is
  short the line stops (PRODUCTION_BLOCKED) and restarts the instant the missing pallet is dropped,
  then keeps its takt from there. Stops are logged with every POU waited for (`result.blocks`).
  `shortage: 'pass'` keeps the M4 behaviour (short rack moves on, pieces owed) for comparison.
  Output is labelled material-feasible: no station cycle times are known.
- **Scenario configuration** (left panel): rate, shift length × shifts, Bloom share, shortage
  rule; inspection interval, DSV prep time and teams, lead time, Kanbans per part; POU reorder
  point and starting stock; CLS / DSV handlers (capped by parking bays), speeds, load time, CLS
  priority; seed. Edits are a draft until *Apply & rerun*; every field carries its confidence.
  Scenarios can be saved, saved as, duplicated and deleted (browser storage; baseline read-only).
- **Third Kanban** (Experiment B): an extra full set of pallets held prepared at DSV. A collected
  card goes straight to staging and DSV re-prepares the spare. Its pieces sit outside the floor
  stock and are reported as extra inventory.
- **Starting stock** (Experiment E): per part, Kanban fill (empties Kanban #1 first; an empty
  Kanban starts with its card on the board) and POU fill. The random stream is drawn identically
  whatever the overrides, so scenarios share rack models (common random numbers).
- **Experiments A–E** (Production Simulator tab) generate scenario sets from the applied settings
  and the focus parts; KPIs per scenario are computed one run at a time (`src/sim/kpis.ts`).
- **Placeholder-driven findings** (seed 7, 10 h): baseline 51/51 racks, no stops. 6/h: 98 %.
  8/h: 83 %, line stopped 1.6 h, almost all on T Shelf (WS5) and Battery Shelves (WS3); more
  handlers barely help, a third Kanban on those two parts halves the stop time and shorter DSV
  prep helps similarly. 10/h: 66 %, 3.3 h stopped. Treat as questions for DSV until prep time,
  handler count and speeds are confirmed.

## 10. Milestone 6 notes: dashboard, comparison and acceptance

- **Dashboard** (Factory Overview, bottom panel, default tab): twelve KPI tiles for the run up to
  the clock (target, completed, attainment, time lost, shortage events, empty Kanbans, pending
  refills, average refill lead, handler utilisation, stock in transit / at POU / in Kanbans) and
  five charts: racks vs target with stop bands, floor stock by location, the replenishment loop,
  handlers busy, and the eight lowest-coverage parts now. Everything is marked simulated except
  the target rate. Series are sampled every 5 min (`computeSeries` in `src/sim/kpis.ts`).
- **Chart colours**: the validated default categorical palette's dark steps (blue, orange, aqua,
  yellow), checked against the dark surface (all checks pass); the reserved critical red only marks
  line stops. Colour follows the scenario in the comparison: each keeps its slot while selected.
- **Event log**: the brief's event vocabulary (PRODUCTION_REQUESTED, MATERIAL_ALLOCATED,
  KANBAN_EMPTY, REPLENISHMENT_REQUESTED, REPLENISHMENT_PREPARED, HANDLER_DISPATCHED,
  HANDLER_ARRIVED, MATERIAL_DELIVERED, MATERIAL_CONSUMED, PRODUCTION_BLOCKED / RESUMED,
  RACK_COMPLETED, plus KANBAN_REPLENISHED and BOARD_INSPECTION), derived from the run, filterable;
  clicking an event locates it in 3D. Allocation is the reservation of a Kanban pallet at dispatch.
- **Scenario Comparison tab**: up to four scenarios, the first is the reference. KPI table with
  ▲▼ deltas (green better, red worse, grey neutral), a one-line summary of what each scenario
  changes, top constraints per scenario, and overlaid charts (racks, cumulative lost time, loop
  size, attainment).
- **Acceptance tests** (`src/acceptance.test.ts`): the brief's twelve criteria, one test each,
  against the real engine and store. #12 samples every handler's body once a second across two full
  shifts (~100k points) against walls, racking, columns, equipment and every pallet position other
  than the one being handled. #11 builds every procedural model and checks it against the manifest;
  it caught the racking bay's manifest height (floor to top instead of the beams' own extent),
  now fixed with a `floorOffset`, so a correctly modelled bay GLB is no longer rejected.

## 11. Milestones

1. **Factory environment and static assets** (done) — layout module, procedural asset library, building, Kanban
   area populated from the sheet, line, POU, DSV racking, UI shell.
2. Clickable objects, camera presets and follow modes, asset details panel. **Done.**
3. Route graph and smooth handler movement along validated routes. **Done.**
4. Part-level inventory and Kanban state machine. **Done.**
5. Scenario controls and the discrete-event engine. **Done.**
6. KPI dashboard, scenario comparison, acceptance tests. **Done.**
