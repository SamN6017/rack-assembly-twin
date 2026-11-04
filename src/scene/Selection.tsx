import { Edges, Html } from '@react-three/drei'
import { useUi } from '../store/uiStore'
import { resolveEntity, slotBounds, type Bounds } from './entities'

const PAD = 0.05

function BoundsBox({ b, color, opacity, thick }: { b: Bounds; color: string; opacity: number; thick?: boolean }) {
  return (
    <mesh position={[b.x, b.y, b.z]} raycast={() => null} renderOrder={10}>
      <boxGeometry args={[b.w + PAD * 2, b.h + PAD * 2, b.d + PAD * 2]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      <Edges color={color} lineWidth={thick ? 2.5 : 1.5} />
    </mesh>
  )
}

/**
 * Outline for the selected and hovered entity, the whole Kanban for a Kanban pallet, and a hover tag.
 * The tag's Html stays mounted and is only hidden: drei's Html owns a separate React root, and
 * mounting/unmounting it on every pointer move races React's render and throws.
 */
export function Selection() {
  // Moving entities (handlers) draw their own selection ring; a static box would be left behind.
  // Select ids, then resolve: a selector returning a fresh object would re-render forever.
  const selectedId = useUi((s) => s.selected)
  const hoveredId = useUi((s) => (s.hovered !== s.selected ? s.hovered : null))
  const selected = selectedId ? resolveEntity(selectedId) : null
  const hovered = hoveredId ? resolveEntity(hoveredId) : null
  const staticSel = selected && selected.kind !== 'handler' ? selected : null
  const staticHover = hovered && hovered.kind !== 'handler' ? hovered : null
  const slot = selected?.slotId ? slotBounds(selected.slotId) : null
  const tagPos: [number, number, number] = staticHover
    ? [staticHover.bounds.x, staticHover.bounds.y + staticHover.bounds.h / 2 + 0.35, staticHover.bounds.z]
    : [0, -100, 0]

  return (
    <>
      {slot && <BoundsBox b={slot} color="#38bdf8" opacity={0.06} />}
      {staticSel && <BoundsBox b={staticSel.bounds} color="#38bdf8" opacity={0.12} thick />}
      {staticHover && <BoundsBox b={staticHover.bounds} color="#e5e7eb" opacity={0.05} />}
      <Html position={tagPos} center zIndexRange={[40, 30]} style={{ pointerEvents: 'none', display: staticHover ? 'block' : 'none' }}>
        <div className="whitespace-nowrap rounded bg-neutral-950/90 px-2 py-1 text-[11px] text-neutral-100 shadow-lg ring-1 ring-white/15">
          {staticHover?.label}
        </div>
      </Html>
    </>
  )
}
