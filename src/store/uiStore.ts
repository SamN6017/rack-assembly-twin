import { create } from 'zustand'

export type Tab = 'factory' | 'kanban' | 'simulator' | 'compare' | 'assets'
export type CameraPreset = 'iso' | 'top' | 'line' | 'kanban' | 'dsv'
export type Layer = 'labels' | 'signs' | 'routes' | 'overlays'
/** Overview: orbit camera and presets. Walk: first-person. Station / rack: framing or following one. */
export type CameraMode = 'overview' | 'walk' | 'station' | 'rack'
/** How much operational detail the 3D view shows. Remembered separately for walking and overview. */
export type DisplayLevel = 'minimal' | 'standard' | 'detailed'

interface UiState {
  tab: Tab
  camera: { preset: CameraPreset; nonce: number }
  layers: Record<Layer, boolean>
  /** Entity id (see scene/entities.ts) of the selected object. */
  selected: string | null
  hovered: string | null
  /** Entity the camera keeps centred while it moves. */
  follow: string | null
  /** Bumped to ask the camera to frame the selection. */
  focusNonce: number
  cameraMode: CameraMode
  /** First-person: whether the mouse is captured (pointer lock). */
  walkLocked: boolean
  detailOverview: DisplayLevel
  detailWalk: DisplayLevel
  /** 3D view fills the window; side panels and dashboard are hidden. */
  expanded: boolean
  /** Layout to restore when the walkthrough ends (walking expands the view). */
  expandedBeforeWalk: boolean
  setTab: (tab: Tab) => void
  setCamera: (preset: CameraPreset) => void
  toggleLayer: (layer: Layer) => void
  select: (id: string | null, opts?: { focus?: boolean }) => void
  hover: (id: string | null) => void
  setFollow: (id: string | null) => void
  focusSelected: () => void
  enterWalk: () => void
  exitWalk: () => void
  setWalkLocked: (locked: boolean) => void
  focusStation: (stationId: string) => void
  followRack: (rackEntityId: string) => void
  setDetail: (level: DisplayLevel) => void
  setExpanded: (expanded: boolean) => void
}

/** Display level in force for the current camera mode. */
export const displayLevel = (s: Pick<UiState, 'cameraMode' | 'detailOverview' | 'detailWalk'>): DisplayLevel =>
  s.cameraMode === 'walk' ? s.detailWalk : s.detailOverview

/** Any camera change that ends the walkthrough also restores the layout it replaced. */
const leaveWalk = (s: UiState) => (s.cameraMode === 'walk' ? { expanded: s.expandedBeforeWalk, walkLocked: false } : {})

export const useUi = create<UiState>((set) => ({
  tab: 'factory',
  camera: { preset: 'iso', nonce: 0 },
  layers: { labels: true, signs: true, routes: true, overlays: false },
  selected: null,
  hovered: null,
  follow: null,
  focusNonce: 0,
  cameraMode: 'overview',
  walkLocked: false,
  detailOverview: 'standard',
  detailWalk: 'minimal',
  expanded: false,
  expandedBeforeWalk: false,
  setTab: (tab) => set({ tab }),
  // nonce lets the same preset be re-applied after the user has orbited away;
  // choosing a preset also ends follow mode, otherwise the camera would snap straight back.
  setCamera: (preset) => set((s) => ({ ...leaveWalk(s), camera: { preset, nonce: s.camera.nonce + 1 }, follow: null, cameraMode: 'overview' })),
  toggleLayer: (layer) => set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  select: (id, opts) => set((s) => ({
    selected: id,
    follow: id === null ? null : s.follow,
    focusNonce: opts?.focus && id ? s.focusNonce + 1 : s.focusNonce,
  })),
  hover: (id) => set((s) => (s.hovered === id ? s : { hovered: id })),
  // Following anything leaves the walkthrough; following a line rack is the rack-follow mode.
  setFollow: (id) => set((s) => ({ ...leaveWalk(s), follow: id, cameraMode: id?.startsWith('linerack:') ? 'rack' : 'overview' })),
  focusSelected: () => set((s) => (s.selected ? { focusNonce: s.focusNonce + 1 } : s)),
  // Walking is immersive: the view expands, and the previous layout comes back on exit.
  enterWalk: () => set((s) => (s.cameraMode === 'walk' ? s : { cameraMode: 'walk', follow: null, expandedBeforeWalk: s.expanded, expanded: true })),
  // Leaving the walk returns to the overview camera.
  exitWalk: () => set((s) => ({ cameraMode: 'overview', walkLocked: false, expanded: s.expandedBeforeWalk, camera: { preset: 'iso', nonce: s.camera.nonce + 1 } })),
  setWalkLocked: (walkLocked) => set({ walkLocked }),
  focusStation: (stationId) => set((s) => ({ ...leaveWalk(s), selected: `station:${stationId}`, follow: null, cameraMode: 'station', focusNonce: s.focusNonce + 1 })),
  followRack: (id) => set((s) => ({ ...leaveWalk(s), selected: id, follow: id, cameraMode: 'rack', focusNonce: s.focusNonce + 1 })),
  setDetail: (level) => set((s) => (s.cameraMode === 'walk' ? { detailWalk: level } : { detailOverview: level })),
  setExpanded: (expanded) => set({ expanded }),
}))
