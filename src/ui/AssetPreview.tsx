import { Bounds, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import type { RenderPart } from '../assets/loadAsset'

export interface PreviewItem { parts: RenderPart[]; y?: number; scaleY?: number }

/** Small turntable view of one model, framed automatically. */
export function AssetPreview({ items, height = 190 }: { items: PreviewItem[]; height?: number }) {
  return (
    <div className="overflow-hidden rounded-md bg-gradient-to-b from-neutral-800/60 to-neutral-900 ring-1 ring-white/10" style={{ height }}>
      <Canvas camera={{ position: [3, 2.2, 3], fov: 35 }} dpr={[1, 2]} gl={{ toneMapping: THREE.ACESFilmicToneMapping }}>
        <hemisphereLight args={['#ffffff', '#444444', 1.1]} />
        <directionalLight position={[4, 6, 3]} intensity={1.6} />
        <Bounds fit clip observe margin={1.25}>
          <group>
            {items.map((it, i) => (
              <group key={i} position-y={it.y ?? 0} scale-y={it.scaleY ?? 1}>
                {it.parts.map((p, j) => <mesh key={j} geometry={p.geometry} material={p.material} />)}
              </group>
            ))}
          </group>
        </Bounds>
        <OrbitControls makeDefault autoRotate autoRotateSpeed={1.2} enablePan={false} />
      </Canvas>
    </div>
  )
}
