import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { MatKey } from '../materials'

export interface AssetPart { mat: MatKey; geometry: THREE.BufferGeometry }

/**
 * Collects primitive pieces per material and merges them into one geometry per material,
 * so a whole asset renders in a handful of draw calls and can be instanced.
 */
export class GeoBuilder {
  private pieces = new Map<MatKey, THREE.BufferGeometry[]>()

  add(mat: MatKey, geo: THREE.BufferGeometry): this {
    const g = geo.index ? geo.toNonIndexed() : geo
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2))
    const list = this.pieces.get(mat) ?? []
    list.push(g)
    this.pieces.set(mat, list)
    return this
  }

  /** Box by size, positioned by its centre. */
  box(mat: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0): this {
    const g = new THREE.BoxGeometry(w, h, d)
    if (rotX) g.rotateX(rotX)
    if (rotZ) g.rotateZ(rotZ)
    if (rotY) g.rotateY(rotY)
    g.translate(x, y, z)
    return this.add(mat, g)
  }

  /** Cylinder along `axis`, positioned by its centre. */
  cyl(mat: MatKey, r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', segments = 12, rBottom = r): this {
    const g = new THREE.CylinderGeometry(r, rBottom, len, segments)
    if (axis === 'x') g.rotateZ(Math.PI / 2)
    if (axis === 'z') g.rotateX(Math.PI / 2)
    g.translate(x, y, z)
    return this.add(mat, g)
  }

  /** Thin bar between two points (bracing, handles). */
  bar(mat: MatKey, size: number, a: THREE.Vector3, b: THREE.Vector3): this {
    const len = a.distanceTo(b)
    const g = new THREE.BoxGeometry(size, len, size)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    g.applyQuaternion(q)
    const mid = a.clone().add(b).multiplyScalar(0.5)
    g.translate(mid.x, mid.y, mid.z)
    return this.add(mat, g)
  }

  /** Merge another builder's pieces in, transformed. */
  include(other: GeoBuilder, matrix: THREE.Matrix4): this {
    for (const [mat, list] of other.pieces) for (const g of list) this.add(mat, g.clone().applyMatrix4(matrix))
    return this
  }

  build(): AssetPart[] {
    const out: AssetPart[] = []
    for (const [mat, list] of this.pieces) {
      const merged = mergeGeometries(list, false)
      if (!merged) throw new Error(`Could not merge geometry for material ${mat}`)
      merged.computeBoundingBox()
      merged.computeBoundingSphere()
      out.push({ mat, geometry: merged })
    }
    return out
  }
}

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

export function translation(x: number, y: number, z: number, rotY = 0): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z)
}
