/**
 * Options the agent offered in prose ("1. Single pack – ₹20 / 2. Pack of 2 – ₹40 — which would
 * you like?"), so the reply can show them as buttons. The `clarify` tool is the structured way to
 * ask, but models often write the list instead; this recovers the same affordance from the text.
 *
 * Only the reply's LAST list, with short items, and only where that list is what the reply ends
 * on: followed by a question asking the user to choose, or closing the reply outright when the
 * user's own message asked for a choice ("which one would I like", "give me options") — and never
 * a recap of work done ("Done:", "Added…"). A list of facts stays text.
 */

const ITEM_RE = /^\s{0,3}(?:\d{1,2}[.)]|[-*•])\s+(.+?)\s*$/

const CHOICE_ASK_RE =
  /\b(which|choose|pick|prefer|select|option|options|would you like|do you want|want me to|should i|shall i|or)\b/i

const MIN_CHOICES = 2
const MAX_CHOICES = 8
const MAX_CHOICE_CHARS = 120
const MAX_QUESTION_CHARS = 240
// A list that closes the reply with no question is only read as options when it is short.
const MAX_BARE_CHOICES = 6
const MAX_BARE_CHOICE_CHARS = 80

const RECAP_RE =
  /\b(done|added|created|updated|removed|deleted|completed|finished|fixed|changed|changes|summary|steps|here'?s what)\b/i

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

// The user's message asked to be offered a choice.
const CHOICE_REQUEST_RE = /\b(which|choose|pick|option|options|prefer|would like|suggest|recommend|alternatives)\b/i

export interface ReplyChoiceContext {
  /** The user message this reply answers. */
  userMessage?: string
}

export interface StructuredQuickReplies {
  allow_custom_input?: boolean
  message: string
  options: string[]
}

/**
 * Extracts a QuickReplies structured JSON payload if present in the text, either as raw JSON
 * or fenced inside ```json blocks.
 */
export function parseStructuredQuickReplies(text: string): null | StructuredQuickReplies {
  if (!text || typeof text !== 'string') {
    return null
  }

  let candidate = text.trim()
  // Check if enclosed in markdown code fences
  const fencedMatch = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fencedMatch && fencedMatch[1]) {
    candidate = fencedMatch[1].trim()
  }

  if (!candidate.startsWith('{') || !candidate.endsWith('}')) {
    return null
  }

  try {
    const parsed = JSON.parse(candidate)
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.component === 'QuickReplies' &&
      parsed.props &&
      typeof parsed.props === 'object' &&
      Array.isArray(parsed.props.options) &&
      parsed.props.options.length > 0 &&
      parsed.props.options.every((opt: unknown) => typeof opt === 'string' && opt.trim().length > 0)
    ) {
      return {
        allow_custom_input: parsed.props.allow_custom_input !== false,
        message: typeof parsed.message === 'string' ? parsed.message.trim() : '',
        options: parsed.props.options.map((opt: string) => opt.trim())
      }
    }
  } catch {
    // Not valid JSON
  }

  return null
}

export function parseReplyChoices(markdown: string, context: ReplyChoiceContext = {}): null | string[] {
  const structured = parseStructuredQuickReplies(markdown)
  if (structured) {
    return structured.options
  }

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

  if (after.trim()) {
    return asksToChoose(after) ? items : null
  }

  if (asksToChoose(before)) {
    return items
  }

  const bareOptions =
    CHOICE_REQUEST_RE.test(context.userMessage ?? '') &&
    !RECAP_RE.test(before) &&
    items.length <= MAX_BARE_CHOICES &&
    items.every(item => item.length <= MAX_BARE_CHOICE_CHARS && !RECAP_RE.test(item.split(' ')[0] ?? ''))

  return bareOptions ? items : null
}
