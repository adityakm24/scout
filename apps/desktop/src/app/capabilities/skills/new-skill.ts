/** The skill index in the system prompt truncates longer descriptions
 *  (agent/skill_utils.py SKILL_PROMPT_DESC_LIMIT); the backend refuses them on create. */
export const SKILL_DESCRIPTION_LIMIT = 60

/** tools/skill_manager_tool.py MAX_SKILL_CONTENT_CHARS. */
export const SKILL_CONTENT_LIMIT = 100_000

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/
const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const KEY_RE = /^(\w[\w-]*):\s?(.*)$/
const BLOCK_SCALAR_RE = /^[>|][+-]?$/

export interface NewSkillDraft {
  name: string
  description: string
  instructions: string
  /** Frontmatter an uploaded SKILL.md carried beyond name/description, kept verbatim. */
  extraFrontmatter?: string
}

export function newSkillReady({ name, description, instructions }: NewSkillDraft): boolean {
  const desc = description.trim()

  return (
    NAME_RE.test(name) &&
    name.length <= 64 &&
    desc.length > 0 &&
    desc.length <= SKILL_DESCRIPTION_LIMIT &&
    Boolean(instructions.trim())
  )
}

/** "weekly-status-report" → "Weekly status report". */
function heading(name: string): string {
  const words = name.replace(/[-_.]+/g, ' ').trim()

  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The SKILL.md a user-authored skill is saved as. The description is JSON-quoted,
 *  which YAML reads as a double-quoted scalar, so colons or quotes in it are safe. */
export function newSkillDocument({ name, description, instructions, extraFrontmatter }: NewSkillDraft): string {
  const body = instructions.trim()

  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description.trim())}`,
    ...(extraFrontmatter?.trim() ? [extraFrontmatter.trim()] : []),
    '---',
    '',
    // An uploaded body usually brings its own title.
    ...(body.startsWith('#') ? [] : [`# ${heading(name)}`, '']),
    body,
    ''
  ].join('\n')
}

function unquote(value: string): string {
  const v = value.trim()

  if (v.startsWith('"')) {
    try {
      return String(JSON.parse(v))
    } catch {
      return v.slice(1, -1)
    }
  }

  return v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v
}

/** An uploaded SKILL.md as a draft: name and description go to the form (the user
 *  reviews them), the body becomes the instructions, and every other frontmatter
 *  key rides along untouched. A file without frontmatter is all instructions. */
export function readSkillFile(text: string): NewSkillDraft {
  const match = FRONTMATTER_RE.exec(text)

  if (!match) {
    return { name: '', description: '', instructions: text.trim() }
  }

  const fields: Record<'description' | 'name', string[]> = { description: [], name: [] }
  const kept: string[] = []
  let owner: 'description' | 'name' | null = null

  for (const line of match[1].split(/\r?\n/)) {
    const kv = KEY_RE.exec(line)

    if (kv) {
      owner = kv[1] === 'name' || kv[1] === 'description' ? kv[1] : null

      if (owner) {
        // A folded/literal block (`description: >`) continues on the indented lines.
        if (!BLOCK_SCALAR_RE.test(kv[2].trim())) {
          fields[owner].push(unquote(kv[2]))
        }
      } else {
        kept.push(line)
      }
    } else if (owner) {
      fields[owner].push(line.trim())
    } else {
      kept.push(line)
    }
  }

  return {
    name: fields.name.join(' ').trim(),
    description: fields.description.filter(Boolean).join(' ').trim(),
    instructions: text.slice(match[0].length).trim(),
    extraFrontmatter: kept.join('\n').trim()
  }
}
