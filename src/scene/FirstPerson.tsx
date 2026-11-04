import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EYE_HEIGHT, stepWalker, WALK_SPAWN, type WalkSpeed } from '../sim/walk'
import { useUi } from '../store/uiStore'

const MAX_PITCH = THREE.MathUtils.degToRad(80)

/** Walker position and heading, read by the walkthrough HUD. Mutable, like the sim clock. */
export const walkState = { x: WALK_SPAWN.x, z: WALK_SPAWN.z, yaw: WALK_SPAWN.yaw }

/** Mouse-look sensitivity (radians per pixel) and walking-speed preset; the HUD changes them. */
export const walkSettings: { sensitivity: number; speed: WalkSpeed } = { sensitivity: 0.0022, speed: 'normal' }

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'])

/**
 * First-person walkthrough at eye height. Click the view to capture the mouse (pointer lock), look
 * with the mouse, WASD or arrows to walk, Shift to walk faster, Esc to release the mouse. The walker
 * slides along walls, racking, the conveyor and other solid objects. Walking runs on real time (it
 * is the viewer moving); everything in the factory still runs on simulation time.
 */
export function FirstPerson() {
  const mode = useUi((s) => s.cameraMode)
  return mode === 'walk' ? <Walker /> : null
}

function Walker() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const setEvents = useThree((s) => s.setEvents)
  const st = useRef({ x: walkState.x, z: walkState.z, yaw: walkState.yaw, pitch: -0.05, vx: 0, vz: 0, keys: new Set<string>() })

  useEffect(() => {
    const s = st.current
    const canvas = gl.domElement
    const prevNear = camera.near
    camera.near = 0.05
    camera.updateProjectionMatrix()
    // Pointer events would hit whatever was under the cursor when the mouse was captured.
    setEvents({ enabled: false })

    const locked = () => document.pointerLockElement === canvas
    const onClick = () => { if (!locked()) void canvas.requestPointerLock() }
    const onLockChange = () => {
      useUi.getState().setWalkLocked(locked())
      if (!locked()) s.keys.clear()
    }
    const onMouse = (e: MouseEvent) => {
      if (!locked()) return
      s.yaw -= e.movementX * walkSettings.sensitivity
      s.pitch = THREE.MathUtils.clamp(s.pitch - e.movementY * walkSettings.sensitivity, -MAX_PITCH, MAX_PITCH)
    }
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
    const onDown = (e: KeyboardEvent) => {
      if (typing(e) || !MOVE_KEYS.has(e.code)) return
      s.keys.add(e.code)
      e.preventDefault()
    }
    const onUp = (e: KeyboardEvent) => s.keys.delete(e.code)
    const onBlur = () => s.keys.clear()

    canvas.addEventListener('click', onClick)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('mousemove', onMouse)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      canvas.removeEventListener('click', onClick)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('mousemove', onMouse)
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
      if (locked()) document.exitPointerLock()
      useUi.getState().setWalkLocked(false)
      setEvents({ enabled: true })
      camera.near = prevNear
      camera.rotation.order = 'XYZ'
      camera.updateProjectionMatrix()
    }
  }, [camera, gl, setEvents])

  useFrame((_, delta) => {
    const s = st.current
    // Real time, capped so a stalled frame cannot fling the walker; the sim clock is untouched.
    const dt = Math.min(delta, 0.1)
    const k = s.keys
    const input = {
      forward: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      right: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
    }
    const next = stepWalker(s, input, dt, walkSettings.speed)
    s.x = next.x
    s.z = next.z
    s.vx = next.vx
    s.vz = next.vz
    camera.position.set(s.x, EYE_HEIGHT, s.z)
    camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ')
    walkState.x = s.x
    walkState.z = s.z
    walkState.yaw = s.yaw
  })

  return null
}
