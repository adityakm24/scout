// Text for an OS notification: the agent writes markdown, a notification shows it verbatim, so
// "**Far & East** at [Four Seasons](https://…)" would arrive with its asterisks and URL. Lines
// collapse to one paragraph, since a banner shows two or three lines at most.

const MAX = 180

export function notificationText(markdown: string, max = MAX): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|\*|_|~~|`)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/[*_`~]{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}
