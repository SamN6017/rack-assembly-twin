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
