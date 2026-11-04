import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { PALLET } from '../layout/constants'
import { fallbackParts, resolveAsset, type RenderPart } from '../assets/loadAsset'
import type { AssetId, LoadProfile } from '../assets/manifest'
import { objectRegistry, pickHandlers } from './picking'

export function useAsset(id: AssetId): RenderPart[] {
  const [parts, setParts] = useState(() => fallbackParts(id))
  useEffect(() => {
    let live = true
    resolveAsset(id).then((p) => live && setParts(p))
    return () => { live = false }
  }, [id])
  return parts
}

export function mat4(x: number, y: number, z: number, rotY = 0, scaleY = 1): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationY(rotY)
  if (scaleY !== 1) m.multiply(new THREE.Matrix4().makeScale(1, scaleY, 1))
  return m.setPosition(x, y, z)
}

interface InstancedProps { matrices: THREE.Matrix4[]; ids?: string[]; shadows?: boolean }

function InstancedPart({ part, matrices, ids, shadows = true }: InstancedProps & { part: RenderPart }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [matrices, part])
  const handlers = useMemo(() => (ids ? pickHandlers((e) => (e.instanceId !== undefined ? ids[e.instanceId] : undefined)) : {}), [ids])
  return (
    <instancedMesh
      key={matrices.length}
      ref={ref}
      args={[part.geometry, part.material, matrices.length]}
      castShadow={shadows && !part.material.transparent}
      receiveShadow
      {...handlers}
    />
  )
}

/** Renders parts at many transforms. `ids[i]` makes instance i pickable as that entity. */
export function PartsInstances({ parts, ...rest }: InstancedProps & { parts: RenderPart[] }) {
  if (!rest.matrices.length) return null
  return <>{parts.map((p, i) => <InstancedPart key={i} part={p} {...rest} />)}</>
}

/** Renders one asset at many transforms: one draw call per material. */
export function AssetInstances({ id, ...rest }: InstancedProps & { id: AssetId }) {
  return <PartsInstances parts={useAsset(id)} {...rest} />
}

/** A single, individually addressable model (no instancing), registered for follow mode. */
export function PartsModel({ parts, position, rotY = 0, entityId }: { parts: RenderPart[]; position: [number, number, number]; rotY?: number; entityId?: string }) {
  const ref = useRef<THREE.Group>(null)
  useEffect(() => {
    if (!entityId || !ref.current) return
    objectRegistry.set(entityId, ref.current)
    return () => { objectRegistry.delete(entityId) }
  }, [entityId])
  const handlers = useMemo(() => (entityId ? pickHandlers(() => entityId) : {}), [entityId])
  return (
    <group ref={ref} position={position} rotation-y={rotY} {...handlers}>
      {parts.map((p, i) => <mesh key={i} geometry={p.geometry} material={p.material} castShadow={!p.material.transparent} receiveShadow />)}
    </group>
  )
}

export interface PalletLoad { x: number; z: number; y?: number; rotY?: number; profile: LoadProfile | null; id?: string }

type Group = { m: THREE.Matrix4[]; ids: string[] }

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

/**
 * Pallets plus whatever sits on them, batched by load type. `profile: null` = empty pallet.
 * Ids in `hidden` collapse to zero scale, so stock can change without resizing the instance buffers.
 */
export function PalletLoads({ items, hidden }: { items: PalletLoad[]; hidden?: Set<string> }) {
  const groups = useMemo(() => {
    const mk = (): Group => ({ m: [], ids: [] })
    const g = { pallet: mk(), cartonStack: mk(), crate: mk(), wrappedRack: mk() }
    const push = (grp: Group, m: THREE.Matrix4, id?: string) => {
      grp.m.push(id && hidden?.has(id) ? HIDDEN : m)
      grp.ids.push(id ?? '')
    }
    for (const it of items) {
      const y = it.y ?? 0
      const r = it.rotY ?? 0
      push(g.pallet, mat4(it.x, y, it.z, r), it.id)
      if (!it.profile) continue
      const top = y + PALLET.height
      if (it.profile.kind === 'rack') push(g.wrappedRack, mat4(it.x, top, it.z, r), it.id)
      else if (it.profile.kind === 'crate') push(g.crate, mat4(it.x, top, it.z, r, it.profile.height), it.id)
      else push(g.cartonStack, mat4(it.x, top, it.z, r, it.profile.height), it.id)
    }
    return g
  }, [items, hidden])
  const pickable = items.some((i) => i.id)
  return (
    <>
      {(Object.keys(groups) as (keyof typeof groups)[]).map((k) => (
        <AssetInstances key={k} id={k} matrices={groups[k].m} ids={pickable ? groups[k].ids : undefined} />
      ))}
    </>
  )
}
