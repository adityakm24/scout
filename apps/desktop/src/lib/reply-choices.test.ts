import { describe, expect, it } from 'vitest'

import { parseReplyChoices } from './reply-choices'

describe('parseReplyChoices', () => {
  it('offers the options of a reply that asks the user to pick one', () => {
    const reply = [
      'I found **Kurkure Namkeen (Green Chutney Style)** in the Swiggy Instamart catalog. Here are the available options:',
      '',
      '1. **Single Pack (78.9g)** – ₹20',
      '2. **Pack of 2 (78.9g x 2)** – ₹40',
      '',
      'Which variant would you like to add to your cart?'
    ].join('\n')

    expect(parseReplyChoices(reply)).toEqual(['Single Pack (78.9g) – ₹20', 'Pack of 2 (78.9g x 2) – ₹40'])
  })

  it('reads the lead-in question when the list closes the reply', () => {
    expect(parseReplyChoices('Which store should I use?\n- Zepto\n- Swiggy Instamart')).toEqual([
      'Zepto',
      'Swiggy Instamart'
    ])
  })

  it('offers a short list that closes the reply even without a question', () => {
    expect(parseReplyChoices('1. Dark chocolate-covered strawberries\n2. Spiced roasted chickpeas')).toEqual([
      'Dark chocolate-covered strawberries',
      'Spiced roasted chickpeas'
    ])
  })

  it.each([
    ['a list of facts followed by an open offer', '- Lays is ₹20\n- Kurkure is ₹20\n\nAnything else?'],
    ['a recap of work done', 'Done:\n1. Added Lays\n2. Added Kurkure'],
    ['a recap with no lead-in', '- Added Lays to the cart\n- Removed Kurkure'],
    ['a single item', 'Would you like this one?\n- Lays Classic'],
    ['a list inside a code block', 'Which command?\n```\n- npm i\n- npm ci\n```']
  ])('leaves %s as plain text', (_case, reply) => {
    expect(parseReplyChoices(reply)).toBeNull()
  })
})
