import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { LAYOUT } from '../layout/factoryLayout'
import { boardCards, FILED_POCKETS, TODAY_POCKETS } from '../sim/boardCards'
import { simClock, useSim } from '../store/simStore'
import { STATE_STYLE } from '../ui/kanbanUi'
import { pickHandlers } from './picking'

const MAX = 64
const BOARD_LEN = 3.6
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
const cardGeo = new THREE.BoxGeometry(0.012, 0.15, 0.13)
const cardMat = new THREE.MeshStandardMaterial({ roughness: 0.6 })

function headerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 160
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#1d4f91'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#f2c218'
  ctx.fillRect(0, c.height - 14, c.width, 14)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 92px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText('KANBAN BOARD', c.width / 2, 72)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/**
 * Cards on the physical Kanban board, coloured by digital card state (same colours as the Kanban
 * Board tab), plus a large header sign so the board reads from across the floor. Clicking the
 * board opens its detail panel.
 */
export function BoardCards() {
  const snapshot = useSim((s) => s.snapshot)
  const result = useSim((s) => s.result)
  const ref = useRef<THREE.InstancedMesh>(null)
  const header = useMemo(() => headerTexture(), [])
  const b = LAYOUT.kanbanBoard
  const handlers = useMemo(() => pickHandlers(() => 'equip:kanbanBoard:0'), [])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const cards = boardCards(result, snapshot, simClock.t)
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    for (let i = 0; i < MAX; i++) {
      const card = cards[i]
      if (!card) { mesh.setMatrixAt(i, HIDDEN); continue }
      // Pocket centres follow the board geometry (buildKanbanBoard); cards stand proud of the
      // pocket, later cards in the same pocket fanned slightly lower.
      const today = card.row === 'today'
      const n = today ? TODAY_POCKETS : FILED_POCKETS
      const inset = today ? 0.2 : 0.25
      const z = -BOARD_LEN / 2 + inset + (card.pocket * (BOARD_LEN - 2 * inset)) / (n - 1)
      const y = (today ? 1.5 : 0.95) + 0.13 - card.stack * 0.04
      m.makeTranslation(b.x - 0.04 - card.stack * 0.004, y, b.z + z)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.set(STATE_STYLE[card.state].hex))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [snapshot, result])

  return (
    <group>
      <instancedMesh ref={ref} args={[cardGeo, cardMat, MAX]} frustumCulled={false} {...handlers} />
      {/* Header sign on both faces, above the board frame. */}
      <group position={[b.x, 2.45, b.z]}>
        <mesh rotation-y={-Math.PI / 2} position={[-0.02, 0, 0]}><planeGeometry args={[3.6, 0.56]} /><meshStandardMaterial map={header} roughness={0.6} /></mesh>
        <mesh rotation-y={Math.PI / 2} position={[0.02, 0, 0]}><planeGeometry args={[3.6, 0.56]} /><meshStandardMaterial map={header} roughness={0.6} /></mesh>
      </group>
    </group>
  )
}
