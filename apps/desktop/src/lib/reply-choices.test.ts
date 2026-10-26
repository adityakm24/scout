import { describe, expect, it } from 'vitest'

import { parseReplyChoices, parseStructuredQuickReplies } from './reply-choices'

describe('parseStructuredQuickReplies', () => {
  it('parses raw JSON QuickReplies', () => {
    const raw = JSON.stringify({
      message: 'Which store would you like to order from?',
      component: 'QuickReplies',
      props: {
        options: ['Zepto (10 mins)', 'Blinkit (12 mins)', 'Instamart (15 mins)'],
        allow_custom_input: true
      }
    })

    expect(parseStructuredQuickReplies(raw)).toEqual({
      message: 'Which store would you like to order from?',
      options: ['Zepto (10 mins)', 'Blinkit (12 mins)', 'Instamart (15 mins)'],
      allow_custom_input: true
    })
  })

  it('parses fenced json QuickReplies', () => {
    const fenced = '```json\n{\n  "message": "Pick a size",\n  "component": "QuickReplies",\n  "props": {\n    "options": ["Small", "Medium", "Large"],\n    "allow_custom_input": false\n  }\n}\n```'

    expect(parseStructuredQuickReplies(fenced)).toEqual({
      message: 'Pick a size',
      options: ['Small', 'Medium', 'Large'],
      allow_custom_input: false
    })
  })

  it('rejects invalid or non-QuickReplies objects', () => {
    expect(parseStructuredQuickReplies('{"foo": "bar"}')).toBeNull()
    expect(parseStructuredQuickReplies('not json')).toBeNull()
    expect(parseStructuredQuickReplies('{"component": "QuickReplies", "props": {"options": []}}')).toBeNull()
  })
})

describe('parseReplyChoices', () => {
  it('extracts options from structured QuickReplies JSON', () => {
    const raw = JSON.stringify({
      message: 'Which variant?',
      component: 'QuickReplies',
      props: {
        options: ['Single Pack – ₹20', 'Pack of 2 – ₹40'],
        allow_custom_input: true
      }
    })

    expect(parseReplyChoices(raw)).toEqual(['Single Pack – ₹20', 'Pack of 2 – ₹40'])
  })
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

  it('offers a bare closing list when the user asked to choose', () => {
    const reply = '1. Dark chocolate-covered strawberries\n2. Spiced roasted chickpeas'

    expect(
      parseReplyChoices(reply, { userMessage: 'list two snack options and ask me which one I would like' })
    ).toEqual(['Dark chocolate-covered strawberries', 'Spiced roasted chickpeas'])
    // The same list answering a plain question is information, not a choice.
    expect(parseReplyChoices(reply, { userMessage: 'what snacks are healthy?' })).toBeNull()
  })

  it.each([
    ['a list of facts followed by an open offer', '- Lays is ₹20\n- Kurkure is ₹20\n\nAnything else?'],
    ['a recap of work done', 'Done:\n1. Added Lays\n2. Added Kurkure'],
    ['a recap with no lead-in', '- Added Lays to the cart\n- Removed Kurkure'],
    ['a bare list with no ask anywhere', '- Gordon Beach\n- Frishman Beach'],
    ['a single item', 'Would you like this one?\n- Lays Classic'],
    ['a list inside a code block', 'Which command?\n```\n- npm i\n- npm ci\n```']
  ])('leaves %s as plain text', (_case, reply) => {
    expect(parseReplyChoices(reply)).toBeNull()
  })
})
