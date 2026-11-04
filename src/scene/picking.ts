import type { ThreeEvent } from '@react-three/fiber'
import type * as THREE from 'three'
import { useUi } from '../store/uiStore'

/** Pixels the pointer may move between down and up and still count as a click (not an orbit drag). */
const CLICK_SLOP = 4

/** Live Object3D per entity id, for objects that may move (follow camera reads world position). */
export const objectRegistry = new Map<string, THREE.Object3D>()

function setCursor(c: string) {
  document.body.style.cursor = c
}

/** Pointer handlers that map a hit to an entity id. Click selects, double-click selects and frames. */
export function pickHandlers(idOf: (e: ThreeEvent<PointerEvent | MouseEvent>) => string | undefined) {
  const { select, hover } = useUi.getState()
  const over = (e: ThreeEvent<PointerEvent>) => {
    const id = idOf(e)
    if (!id) return
    e.stopPropagation()
    hover(id)
    setCursor('pointer')
  }
  return {
    onPointerOver: over,
    onPointerMove: over,
    onPointerOut: () => {
      hover(null)
      setCursor('auto')
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      const id = idOf(e)
      if (!id || e.delta > CLICK_SLOP) return
      e.stopPropagation()
      select(id)
    },
    onDoubleClick: (e: ThreeEvent<MouseEvent>) => {
      const id = idOf(e)
      if (!id) return
      e.stopPropagation()
      select(id, { focus: true })
    },
  }
}
