import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { create } from 'zustand'
import { ASSETS, validateBounds, type AssetId } from './manifest'
import { MATERIALS } from './materials'

export interface RenderPart { geometry: THREE.BufferGeometry; material: THREE.Material }

export type AssetSource = 'fallback' | 'glb' | 'glb-rejected'
export interface AssetStatus { source: AssetSource; note?: string }

/** Load status per asset, shown in the Asset Library. */
export const useAssetStatus = create<Record<string, AssetStatus>>(() => ({}))

const fallbackCache = new Map<AssetId, RenderPart[]>()

export function fallbackParts(id: AssetId): RenderPart[] {
  let parts = fallbackCache.get(id)
  if (!parts) {
    parts = ASSETS[id].build().build().map((p) => ({ geometry: p.geometry, material: MATERIALS[p.mat] }))
    fallbackCache.set(id, parts)
  }
  return parts
}

/**
 * Loads a GLB, bakes node transforms into the geometry, and checks its bounding box against the
 * manifest dimensions. A model in the wrong units (cm/mm) or orientation fails the check and the
 * procedural fallback stays in place.
 */
async function loadGlbParts(id: AssetId, url: string): Promise<RenderPart[]> {
  const gltf = await new GLTFLoader().loadAsync(url)
  gltf.scene.updateMatrixWorld(true)
  const parts: RenderPart[] = []
  const box = new THREE.Box3()
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
    geometry.computeBoundingBox()
    box.union(geometry.boundingBox!)
    parts.push({ geometry, material: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material })
  })
  if (!parts.length) throw new Error('GLB contains no meshes')
  const problem = validateBounds(id, box.getSize(new THREE.Vector3()).toArray(), box.min.y)
  if (problem) throw new Error(problem)
  return parts
}

const glbCache = new Map<AssetId, Promise<RenderPart[]>>()

/** Returns the procedural parts immediately and swaps in the GLB once it has loaded and validated. */
export async function resolveAsset(id: AssetId): Promise<RenderPart[]> {
  const url = ASSETS[id].glb
  if (!url) {
    useAssetStatus.setState({ [id]: { source: 'fallback', note: 'No GLB in manifest' } })
    return fallbackParts(id)
  }
  let promise = glbCache.get(id)
  if (!promise) {
    promise = loadGlbParts(id, url)
    glbCache.set(id, promise)
  }
  try {
    const parts = await promise
    useAssetStatus.setState({ [id]: { source: 'glb', note: url } })
    return parts
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err)
    console.warn(`[assets] ${id}: GLB rejected, using procedural fallback. ${note}`)
    useAssetStatus.setState({ [id]: { source: 'glb-rejected', note } })
    return fallbackParts(id)
  }
}
