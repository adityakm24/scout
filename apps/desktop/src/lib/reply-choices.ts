/**
 * Options the agent offered in prose ("1. Single pack – ₹20 / 2. Pack of 2 – ₹40 — which would
 * you like?"), so the reply can show them as buttons. The `clarify` tool is the structured way to
 * ask, but models often write the list instead; this recovers the same affordance from the text.
 *
 * Deliberately narrow: only the reply's LAST list, only when the reply asks the user to choose,
 * and only short items. A list of facts followed by "Anything else?" stays text.
 */

const ITEM_RE = /^\s{0,3}(?:\d{1,2}[.)]|[-*•])\s+(.+?)\s*$/

const CHOICE_ASK_RE =
  /\b(which|choose|pick|prefer|select|option|options|would you like|do you want|want me to|should i|shall i|or)\b/i

const MIN_CHOICES = 2
const MAX_CHOICES = 8
const MAX_CHOICE_CHARS = 120
const MAX_QUESTION_CHARS = 240

/** Markdown emphasis, inline code and links reduced to their visible text. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .replace(/[.;,]\s*$/, '')
    .trim()
}

function asksToChoose(text: string): boolean {
  const question = text.trim()

  return (
    question.length > 0 &&
    question.length <= MAX_QUESTION_CHARS &&
    question.includes('?') &&
    CHOICE_ASK_RE.test(question)
  )
}

export function parseReplyChoices(markdown: string): null | string[] {
  if (markdown.includes('```')) {
    return null
  }

  const lines = markdown.replace(/\r/g, '').split('\n')
  const end = lines.findLastIndex(line => ITEM_RE.test(line))

  if (end < 0) {
    return null
  }

  // Walk up the contiguous list, allowing single blank lines between items.
  let start = end

  while (start > 0) {
    const above = lines[start - 1]

    if (ITEM_RE.test(above)) {
      start -= 1
    } else if (!above.trim() && start > 1 && ITEM_RE.test(lines[start - 2])) {
      start -= 2
    } else {
      break
    }
  }

  const items = lines
    .slice(start, end + 1)
    .map(line => line.match(ITEM_RE)?.[1])
    .filter((item): item is string => Boolean(item))
    .map(plain)

  if (
    items.length < MIN_CHOICES ||
    items.length > MAX_CHOICES ||
    items.some(item => !item || item.length > MAX_CHOICE_CHARS || item.endsWith(':'))
  ) {
    return null
  }

  // The ask is what follows the list or, when the list closes the reply, the line that led into it.
  const after = lines.slice(end + 1).join(' ')
  const before = lines.slice(0, start).findLast(line => line.trim()) ?? ''

  return asksToChoose(after.trim() ? after : before) ? items : null
}
