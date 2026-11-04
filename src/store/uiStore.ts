import { create } from 'zustand'

export type Tab = 'factory' | 'kanban' | 'simulator' | 'compare' | 'assets'
export type CameraPreset = 'iso' | 'top' | 'line' | 'kanban' | 'dsv'
export type Layer = 'labels' | 'signs' | 'routes' | 'overlays'

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
  setTab: (tab: Tab) => void
  setCamera: (preset: CameraPreset) => void
  toggleLayer: (layer: Layer) => void
  select: (id: string | null, opts?: { focus?: boolean }) => void
  hover: (id: string | null) => void
  setFollow: (id: string | null) => void
  focusSelected: () => void
}

export const useUi = create<UiState>((set) => ({
  tab: 'factory',
  camera: { preset: 'iso', nonce: 0 },
  layers: { labels: true, signs: true, routes: true, overlays: false },
  selected: null,
  hovered: null,
  follow: null,
  focusNonce: 0,
  setTab: (tab) => set({ tab }),
  // nonce lets the same preset be re-applied after the user has orbited away;
  // choosing a preset also ends follow mode, otherwise the camera would snap straight back.
  setCamera: (preset) => set((s) => ({ camera: { preset, nonce: s.camera.nonce + 1 }, follow: null })),
  toggleLayer: (layer) => set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  select: (id, opts) => set((s) => ({
    selected: id,
    follow: id === null ? null : s.follow,
    focusNonce: opts?.focus && id ? s.focusNonce + 1 : s.focusNonce,
  })),
  hover: (id) => set((s) => (s.hovered === id ? s : { hovered: id })),
  setFollow: (id) => set({ follow: id }),
  focusSelected: () => set((s) => (s.selected ? { focusNonce: s.focusNonce + 1 } : s)),
}))
