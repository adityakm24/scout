import { describe, expect, it } from 'vitest'

import { parseFrontmatter } from './frontmatter'
import { newSkillDocument, newSkillReady, readSkillFile, SKILL_DESCRIPTION_LIMIT } from './new-skill'

describe('new skill document', () => {
  it('reads back as the name, description and instructions the user typed', () => {
    const draft = {
      name: 'standup',
      description: 'Standup: "yesterday / today" notes.',
      instructions: 'List blockers first.'
    }
    const { body, meta } = parseFrontmatter(newSkillDocument(draft))
    const fields = Object.fromEntries(meta)

    expect(fields.name).toBe('standup')
    expect(JSON.parse(fields.description)).toBe(draft.description)
    expect(body).toContain(draft.instructions)
  })

  it('is only ready within the prompt-index description budget', () => {
    const draft = { name: 'standup', description: 'x'.repeat(SKILL_DESCRIPTION_LIMIT), instructions: 'Do it.' }

    expect(newSkillReady(draft)).toBe(true)
    expect(newSkillReady({ ...draft, description: 'x'.repeat(SKILL_DESCRIPTION_LIMIT + 1) })).toBe(false)
    expect(newSkillReady({ ...draft, instructions: '  ' })).toBe(false)
  })

  it("keeps an uploaded SKILL.md's other frontmatter and body through a save", () => {
    const uploaded = [
      '---',
      'name: trip-planner',
      'description: >',
      '  Plan a trip:',
      '  flights, hotels.',
      'version: 1.2.0',
      'metadata:',
      '  scout:',
      '    related_skills: [maps]',
      '---',
      '# Trip planner',
      '',
      'Ask for dates first.'
    ].join('\n')

    const draft = readSkillFile(uploaded)
    expect(draft).toMatchObject({ name: 'trip-planner', description: 'Plan a trip: flights, hotels.' })

    const saved = newSkillDocument(draft)
    const fields = Object.fromEntries(parseFrontmatter(saved).meta)
    expect(fields.version).toBe('1.2.0')
    expect(fields.metadata).toContain('related_skills: [maps]')
    expect(saved.match(/^# Trip planner$/gm)).toHaveLength(1)
    expect(parseFrontmatter(saved).body).toContain('Ask for dates first.')
  })

  it('treats a file without frontmatter as all instructions', () => {
    expect(readSkillFile('Just do the thing.\n')).toEqual({
      name: '',
      description: '',
      instructions: 'Just do the thing.'
    })
  })
})
