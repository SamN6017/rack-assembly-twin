import { useMemo } from 'react'
import * as THREE from 'three'
import { MATERIALS, makeConcreteTexture } from '../assets/materials'
import { BUILDING } from '../layout/constants'
import { LAYOUT } from '../layout/factoryLayout'
import { AssetInstances, mat4 } from './Instanced'

const W = BUILDING.maxX - BUILDING.minX
const D = BUILDING.maxZ - BUILDING.minZ
const CX = (BUILDING.minX + BUILDING.maxX) / 2
const CZ = (BUILDING.minZ + BUILDING.maxZ) / 2

export function Building() {
  const floorMat = useMemo(() => {
    const metresPerTile = 12
    const tex = makeConcreteTexture(metresPerTile, 6)
    tex.repeat.set(W / metresPerTile, D / metresPerTile)
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.05 })
  }, [])

  const columns = useMemo(() => LAYOUT.columns.map((c) => mat4(c.x, 0, c.z)), [])
  const H = BUILDING.wallHeight
  const t = 0.3

  // Dock doors on the DSV (west) wall, where inbound material arrives. Positions illustrative.
  const docks = [6, 14, 22, 30, 38]

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[CX, 0, CZ]} receiveShadow material={floorMat}>
        <planeGeometry args={[W, D]} />
      </mesh>
      {/* Walls: low enough on the camera side to see in from the default isometric view. */}
      <mesh position={[CX, H / 2, BUILDING.minZ - t / 2]} material={MATERIALS.wall} receiveShadow castShadow>
        <boxGeometry args={[W + 2 * t, H, t]} />
      </mesh>
      <mesh position={[BUILDING.minX - t / 2, H / 2, CZ]} material={MATERIALS.wall} receiveShadow castShadow>
        <boxGeometry args={[t, H, D]} />
      </mesh>
      <mesh position={[BUILDING.maxX + t / 2, 0.6, CZ]} material={MATERIALS.wall} receiveShadow>
        <boxGeometry args={[t, 1.2, D]} />
      </mesh>
      <mesh position={[CX, 0.6, BUILDING.maxZ + t / 2]} material={MATERIALS.wall} receiveShadow>
        <boxGeometry args={[W + 2 * t, 1.2, t]} />
      </mesh>
      {docks.map((z) => (
        <group key={z} position={[BUILDING.minX + 0.02, 0, z]}>
          <mesh position={[0, 1.6, 0]} material={MATERIALS.steelGrey}>
            <boxGeometry args={[0.06, 3.2, 3]} />
          </mesh>
          <mesh position={[0.05, 3.3, 0]} material={MATERIALS.safetyYellow}>
            <boxGeometry args={[0.08, 0.15, 3.2]} />
          </mesh>
        </group>
      ))}
      <AssetInstances id="column" matrices={columns} />
    </group>
  )
}
