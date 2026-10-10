import { describe, expect, it } from 'vitest'

import { introFit } from './use-intro-clearance'

// The greeting ends above the composer (floor) and starts below the agent header (ceiling).
describe('introFit', () => {
  it('leaves a greeting that already clears the composer alone', () => {
    expect(introFit({ bottom: 400, height: 250 }, 450, 80)).toEqual({ lift: 0, scale: 1 })
  })

  it('lifts a greeting that reaches the composer, keeping it whole when it fits', () => {
    expect(introFit({ bottom: 480, height: 250 }, 450, 80)).toEqual({ lift: 30, scale: 1 })
  })

  it('shrinks it from the bottom edge when the column is too short, never past the floor', () => {
    const fit = introFit({ bottom: 480, height: 400 }, 450, 130)
    expect(fit.lift).toBe(30)
    expect(fit.scale).toBeCloseTo(320 / 400)
    expect(introFit({ bottom: 480, height: 400 }, 200, 190).scale).toBe(0.6)
  })
})
