/** Min-heap of timed events. Ties break on insertion order, so runs are fully deterministic. */
export class EventQueue<T> {
  private heap: { t: number; seq: number; ev: T }[] = []
  private seq = 0

  get size() { return this.heap.length }

  push(t: number, ev: T) {
    this.heap.push({ t, seq: this.seq++, ev })
    let i = this.heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(i, p)) break
      ;[this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]]
      i = p
    }
  }

  pop(): { t: number; ev: T } | undefined {
    const top = this.heap[0]
    if (!top) return undefined
    const last = this.heap.pop()!
    if (this.heap.length) {
      this.heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < this.heap.length && this.less(l, m)) m = l
        if (r < this.heap.length && this.less(r, m)) m = r
        if (m === i) break
        ;[this.heap[i], this.heap[m]] = [this.heap[m], this.heap[i]]
        i = m
      }
    }
    return { t: top.t, ev: top.ev }
  }

  private less(a: number, b: number) {
    const x = this.heap[a], y = this.heap[b]
    return x.t < y.t || (x.t === y.t && x.seq < y.seq)
  }
}

/** Park-Miller generator: same seed, same sequence. */
export function seededRandom(seed: number) {
  let s = Math.max(1, Math.floor(seed) % 2147483647)
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}
