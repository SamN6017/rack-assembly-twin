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
  Kanban size; content of the sheet's assembly steps WS1–WS5, SUBASSY, WS7, WS8, WS10; Kanban board
  structure; small parts on 2-bin. Five physical line stations (chassis, blades / cassettes, wiring,
  testing, packout), as stated by the line team.
- **Estimated:** which sheet steps each physical station performs (section 13), line shape (one vertical
  line), main aisle on the right, part-number digits other than 1225629 / 1230914.
- **Placeholder:** cycle times (including the test station), handler count/speed/capacity, floor
  dimensions, part dimensions.

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
  Sub-assembly works in step with the station it feeds (blades / cassettes since section 13). Cycle times are unknown, so the takt stands in for them.
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

## 11. V2: physical assembly line, workers and walkthrough

- **Timing model (the one engine change).** V1 indexed the paced line instantaneously. In V2 each
  index starts a physical transfer: every rack rides the conveyor one station together (walking
  beam), taking `transferS` from the conveyor's placeholder speed and acceleration (0.4 m/s,
  0.2 m/s² → ~22 s for the 8.2 m pitch). Each station assembles for the rest of the takt
  (`assemblyS = takt − transferS`). Throughput is unchanged and racks can never collide, because
  they always move together. Material now leaves POU stock when the rack arrives (assembly start);
  the shortage check stays at release, so a rack is never stranded mid-transfer. A rack is complete
  when WS8 finishes it, one takt after entering WS8 (V1 counted arrival at WS8): the 10 h baseline
  is 50 racks, not 51 (the 51st was a pre-loaded rack counted at t = 0). With `transferS = 0`
  the timing reduces to V1's. A takt shorter than transfer + 30 s is rejected.
- **Conveyor layout** (`LAYOUT.conveyor`, estimates): an indexing roller conveyor on the existing
  station line (x = 51), a load position 2 m upstream of WS1 (the next base rack goes on while WS1
  empties), and an outfeed that turns east past WS8 and runs north between the benches and the
  main aisle to a lowering table, from which racks roll along a marked lane into finished staging
  (the top-right box of P1). The U-shaped concept layout was not used: it would have meant moving
  the line, POU column and handler routes. Material-handler routes are unchanged; the conveyor
  beds are obstacles for route checks and the walkthrough.
- **Rack lifecycle** (`src/sim/assemblyLine.ts`, pure): CREATED → MOVING_TO_STATION (load → WS1)
  → ASSEMBLING → WAITING_FOR_TRANSFER (only while the line is stopped) → MOVING_TO_NEXT_STATION …
  → WS8_COMPLETE → MOVING_TO_FINISHED_STAGING → COMPLETED. AT_STATION and ASSEMBLY_COMPLETE are
  instants (arrival, end of the window). Rack ids R-001… (R-001 to R-008 were on the line at shift
  start). Components appear when a station's window ends; the per-station content is V1's
  `INSTALL_SEQUENCE` from the BOM; WS6 has no parts and is labelled a placeholder.
- **Workers**: two per station (16), procedural figures with hard hat, glasses, hi-vis vest, gloves
  and boots; A on the POU side, B between rack and bench, both facing the rack and tested clear of
  conveyor, benches, pallets and each other. Pose is a pure function of station state and sim
  time: a fetch → carry → install → drive fasteners → check loop while assembling; standing clear
  while the rack moves; arms folded when done and waiting; looking to the POU when the station is
  short. The motion is illustrative, not a timed work instruction.
- **Station kit**: hanging sign per station (WS6 grey, placeholder), stack light (green
  assembling, amber waiting or rack moving, red short of material), tool balancer over the rack.
  High-bay fixtures, floor tape round the conveyor, guard rail between the outfeed and main aisle.
- **First-person walkthrough**: eye height 1.7 m, WASD / arrows, Shift faster, mouse look under
  pointer lock, Esc releases, sensitivity slider, *Exit walkthrough* returns to the overview. The
  walker (0.3 m radius) slides along walls, racking, pallets, benches, conveyor and workers; moving
  handlers are not obstacles. A flood-fill test proves both sides of every station, the Kanban
  aisles and the main aisle are reachable from the spawn point. Selecting objects is off while
  walking; a HUD shows the nearest station's rack and state.
- **Camera modes**: overview (presets), first-person, station focus, rack follow.
- **Tests added**: complete rack journeys, no teleporting (speed bound), one rack per station and
  no rack contact (5, 8 and 12 racks/h), never moving before a station finishes, the line frozen
  during stops with the short station flagged, consumption only at arrival, completions matching
  the production counter, worker clearance, walkthrough collision and reachability. 71 tests.

### V2.1 refinements

- **Walking**: presets Slow 2.0 / Normal 3.5 / Fast 5.0 m/s, Shift doubles (sprint 7 m/s at Normal).
  `stepWalker` (src/sim/walk.ts) normalises diagonal input and uses an exponential velocity
  response, so distance covered is the same at any frame rate (tested at 15, 60 and 144 fps). Real
  time only: the simulation clock and rack transport are untouched.
- **Labels** (`src/scene/Labels.tsx`, `src/sim/labelVisibility.ts`): a visibility pass ~8×/s, no
  scene raycasts. Occlusion is a line-of-sight slab test against the layout's solid boxes with
  estimated heights. First-person: within 7 m (hidden beyond 8.5 m: hysteresis), inside a 50° cone,
  and in line of sight; nearest and most central first. Overview: hidden behind geometry, off-screen
  culled, decluttered by priority (stations, then board and line, then areas) so tags never overlap;
  beyond 85 m the eight station tags collapse to one "Assembly line" tag; with the camera near the
  floor, area tags only within 45 m. drei's own display toggling is disabled (`onOcclude`) so the
  pass alone decides; labels stay mounted and never take pointer input.
- **Display levels**, remembered per mode (walk defaults to Minimal, overview to Standard).
  Minimal: station tags, selection, critical alerts (line-stop banner and beacons). Standard: plus
  area and board tags. Detailed: plus each station's rack and state on its tag, rack ID tags (3D
  sprites, naturally occluded), handler status tags, and the material-level overlay.
- **Expanded view**: toolbar on the 3D view (camera mode, start/pause, clock, speed, display level,
  expand/restore, browser fullscreen with in-app fallback, exit walk). Expanded hides the panels
  but keeps them mounted; the canvas keeps its place, so nothing reinitialises and it resizes at
  once. Walking expands automatically and restores the previous layout on exit. A details drawer
  shows the selection; in the walkthrough, E opens the station in view.
- **Physical Kanban board**: large header sign; cards drawn in the pockets from the digital card
  states (`src/sim/boardCards.ts`, no separate state): cards on the replenishment loop in the
  today-row pocket of their due time, refilled cards awaiting filing in the lower row, same colours
  as the Kanban Board tab. Clicking the board lists its cards with due times. A building column
  that stood through the board (V1 layout bug) is now kept clear, with a test.

## 12. Milestones

1. **Factory environment and static assets** (done) — layout module, procedural asset library, building, Kanban
   area populated from the sheet, line, POU, DSV racking, UI shell.
2. Clickable objects, camera presets and follow modes, asset details panel. **Done.**
3. Route graph and smooth handler movement along validated routes. **Done.**
4. Part-level inventory and Kanban state machine. **Done.**
5. Scenario controls and the discrete-event engine. **Done.**
6. KPI dashboard, scenario comparison, acceptance tests. **Done.**
7. V2: conveyor and rack transport, rack lifecycle, 16 workers, first-person walkthrough. **Done.**
8. V2.1: faster walking, mode-aware labels, expanded view, display levels, physical board. **Done.**
9. V2.2: five-station line (section 13). **Done.**

## 13. V2.2: five physical stations

Sections 8–11 describe the line as it was built through V2.1: eight stations named after the
sheet's workstation column (WS1–WS8, with WS6 an empty placeholder). The line team corrected this:
the line has five stations, and the sheet's WS numbers are assembly steps (the sheet uses WS1–WS5,
WS7, WS8 and WS10, never WS6 or WS9). Names below are as given (verified); the step mapping is
inferred from the part types (estimated) and lives in `line_stations` in the extraction JSON.

| Station | Sheet steps | Fits |
|---|---|---|
| ST1 Chassis | WS1, WS2, WS3 | base rack, busbars, rails, battery and top shelves, cable managers / DCN shelf |
| ST2 Blades / cassettes | WS4, WS5 (+ sub-assembly) | water pan, adapter plates, 16 M shelves, 16 T shelves |
| ST3 Wiring | WS7, WS8 | bottom and side drain modules, centre rack cable managers |
| ST4 Testing | none | no parts; its time is the takt like every other station (placeholder) |
| ST5 Packout | WS10 | right, left and front shipping brackets (qty 2 each, now read from the sheet) |

- **Data**: every part keeps `workstation` (the sheet step, as written) and gains `station` (the
  physical station, via `stationOfStep`). Staging, consumption, the sub-assembly link
  (`SUBASSY_FEEDS = 'ST2'`) and the panels all use `station`; tables show both.
- **Layout**: stations sit end to end, each as long as its one-deep POU column needs (minimum
  8.2 m). Chassis stages 14 parts, so it is 20.3 m long; the others are 8.2 m. The rack stops at
  each station's centre. The line is shorter than before (last stop z = 51 instead of 61.4).
- **Timing**: moves are no longer equal, so an index takes as long as the longest move (14.2 m,
  ~38 s at the placeholder conveyor speed); every carrier starts and stops together and shorter
  moves run proportionally slower. Assembly gets the rest of the takt.
- **Rack build-up**: five stages. Testing adds nothing physical; packout adds the shipping
  brackets. Rack states WAITING_FOR_WS1 and WS8_COMPLETE became WAITING_FOR_LOAD and
  PACKOUT_COMPLETE. Workers: 10 (two per station).
- **Still unknown**: whether the mapping above matches the floor, the test station's process and
  time, and the shipping brackets' qty per pallet (so they are staged but not simulated).
