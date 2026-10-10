import { describe, expect, it } from 'vitest'

import { notificationText } from './notification-text'

describe('notification text', () => {
  it('reads as plain words, never markdown', () => {
    const reply =
      '**Top dinner recommendation near you:**\n- **Far & East** at [Four Seasons](https://example.com/fs)\n\n```js\nx()\n```\n## Why\n`cozy` _and_ ~~loud~~ quiet'

    expect(notificationText(reply)).toBe('Top dinner recommendation near you: Far & East at Four Seasons Why cozy and loud quiet')
  })

  it('keeps a banner short', () => {
    expect(notificationText('word '.repeat(100)).length).toBeLessThanOrEqual(180)
  })
})
