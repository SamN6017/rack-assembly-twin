import { describe, expect, it } from 'vitest'
import { boardCards, FILED_POCKETS, TODAY_POCKETS } from './boardCards'
import { DEFAULT_MOVEMENT, runMovementSim, snapshotAt } from './movementSim'

describe('physical Kanban board', () => {
  it('shows exactly the cards the digital board has out, each once, in a valid pocket', () => {
    const r = runMovementSim({ ...DEFAULT_MOVEMENT, ratePerHour: 8 })
    let seen = 0
    for (let t = 0; t < r.horizon; t += 600) {
      const s = snapshotAt(r, t)
      const cards = boardCards(r, s, t)
      const onLoop = [...s.cards].filter(([, c]) => ['EMPTY', 'REQUESTED', 'PREPARING', 'IN_TRANSIT'].includes(c.state)).map(([id]) => id).sort()
      const replenished = [...s.cards].filter(([, c]) => c.state === 'REPLENISHED').map(([id]) => id).sort()
      expect(cards.filter((c) => c.row === 'today').map((c) => c.slotId).sort(), `t=${t}`).toEqual(onLoop)
      expect(cards.filter((c) => c.row === 'filed').map((c) => c.slotId).sort(), `t=${t}`).toEqual(replenished)
      for (const c of cards) {
        expect(c.state).toBe(s.cards.get(c.slotId)!.state)
        expect(c.pocket).toBeGreaterThanOrEqual(0)
        expect(c.pocket).toBeLessThan(c.row === 'today' ? TODAY_POCKETS : FILED_POCKETS)
      }
      seen += onLoop.length
    }
    expect(seen).toBeGreaterThan(10)
  })
})
