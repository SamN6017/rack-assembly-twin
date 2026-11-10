import * as THREE from 'three'
import { modelTab, type KanbanPart } from '../data/parts'

const cache = new Map<string, THREE.CanvasTexture>()

/**
 * Part-number sign as on slide P3: large black number on white, with a coloured tab in the
 * bottom-right corner — yellow = shared by Yawn and Bloom, green = Bloom only, none = Yawn only.
 */
export function partSignTexture(part: KanbanPart): THREE.CanvasTexture {
  const hit = cache.get(part.pn)
  if (hit) return hit
  const w = 512
  const h = 176
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#1b1b1b'
  ctx.lineWidth = 8
  ctx.strokeRect(4, 4, w - 8, h - 8)
  ctx.fillStyle = '#111'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 84px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText(part.pn, w / 2, 70, w - 40)
  ctx.font = '30px "Helvetica Neue", Arial, sans-serif'
  const models = part.models.length > 1 ? 'Yawn + Bloom' : part.models[0]
  ctx.fillText(`${part.description} · ${models}`, w / 2 - 20, 136, w - 120)
  const tab = modelTab(part)
  if (tab !== 'yawn') {
    ctx.fillStyle = tab === 'shared' ? '#f2c218' : '#2e9e4a'
    ctx.beginPath()
    ctx.moveTo(w - 8, h - 70)
    ctx.lineTo(w - 8, h - 8)
    ctx.lineTo(w - 70, h - 8)
    ctx.closePath()
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  cache.set(part.pn, tex)
  return tex
}

/** Hanging station sign on safety blue: station number, operation in large type, a note underneath. */
export function stationSignTexture(title: string, name: string, caption: string, muted: boolean): THREE.CanvasTexture {
  const key = `station:${title}:${name}:${caption}`
  const hit = cache.get(key)
  if (hit) return hit
  const w = 512, h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = muted ? '#4b5563' : '#1d4f91'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#f2c218'
  ctx.lineWidth = 10
  ctx.strokeRect(5, 5, w - 10, h - 10)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '34px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText(title.toUpperCase(), w / 2, 50, w - 40)
  ctx.font = 'bold 76px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText(name, w / 2, 124, w - 40)
  ctx.font = '26px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText(caption, w / 2, 204, w - 40)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  cache.set(key, tex)
  return tex
}

/** Rack ID tag for the Detailed display level: dark plate, white monospace id, model underneath. */
export function rackTagTexture(id: string, model: string): THREE.CanvasTexture {
  const key = `rack:${id}:${model}`
  const hit = cache.get(key)
  if (hit) return hit
  const w = 256, h = 96
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgba(12,18,28,0.88)'
  ctx.beginPath()
  ctx.roundRect(2, 2, w - 4, h - 4, 14)
  ctx.fill()
  ctx.strokeStyle = model === 'Bloom' ? '#2e9e4a' : '#9ca3af'
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 44px ui-monospace, Menlo, monospace'
  ctx.fillText(id, w / 2, 40)
  ctx.font = '22px "Helvetica Neue", Arial, sans-serif'
  ctx.fillStyle = '#cbd5e1'
  ctx.fillText(model, w / 2, 76)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set(key, tex)
  return tex
}
