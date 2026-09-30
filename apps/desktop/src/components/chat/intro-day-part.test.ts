import { describe, expect, it } from 'vitest'

import { en } from '@/i18n/en'

import { dayPart } from './intro'

describe('welcome greeting by time of day', () => {
  it('gives every hour of the day a greeting that the catalog defines', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(en.intro.greeting[dayPart(hour)]).toBeTruthy()
    }
  })

  it('changes greeting only at the documented boundaries', () => {
    const changes: number[] = []

    for (let hour = 1; hour < 24; hour += 1) {
      if (dayPart(hour) !== dayPart(hour - 1)) {
        changes.push(hour)
      }
    }

    expect(changes).toEqual([5, 12, 17, 22])
    expect(dayPart(23)).toBe(dayPart(0))
  })
})
