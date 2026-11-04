import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EYE_HEIGHT, WALK_SPAWN, walkMove } from '../sim/walk'
import { useUi } from '../store/uiStore'

const WALK_SPEED = 1.4    // m/s, normal walking pace
const FAST_SPEED = 3.2    // m/s with Shift
const RESPONSE = 10       // 1/s: how quickly velocity follows the keys (smooth start and stop)
const MAX_PITCH = THREE.MathUtils.degToRad(80)

/** Walker position and heading, read by the walkthrough HUD. Mutable, like the sim clock. */
export const walkState = { x: WALK_SPAWN.x, z: WALK_SPAWN.z, yaw: WALK_SPAWN.yaw }

/** Mouse-look sensitivity in radians per pixel; the HUD slider changes it. */
export const walkSettings = { sensitivity: 0.0022 }

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
    const dt = Math.min(delta, 0.05)
    const k = s.keys
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? FAST_SPEED : WALK_SPEED
    // Camera looks down -Z at yaw 0: forward is (-sin, -cos), right is (cos, -sin).
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw)
    let wx = -sin * fwd + cos * side
    let wz = -cos * fwd - sin * side
    const n = Math.hypot(wx, wz)
    if (n > 0) { wx = (wx / n) * speed; wz = (wz / n) * speed }
    const a = Math.min(1, dt * RESPONSE)
    s.vx += (wx - s.vx) * a
    s.vz += (wz - s.vz) * a
    if (Math.hypot(s.vx, s.vz) > 1e-3) {
      const next = walkMove({ x: s.x, z: s.z }, s.vx * dt, s.vz * dt)
      // Lose the velocity that ran into a wall, so the walker doesn't keep pressing against it.
      if (dt > 0) { s.vx = (next.x - s.x) / dt; s.vz = (next.z - s.z) / dt }
      s.x = next.x
      s.z = next.z
    }
    camera.position.set(s.x, EYE_HEIGHT, s.z)
    camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ')
    walkState.x = s.x
    walkState.z = s.z
    walkState.yaw = s.yaw
  })

  return null
}
