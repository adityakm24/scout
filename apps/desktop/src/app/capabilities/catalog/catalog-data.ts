import { skillCatalogInstallIdentifier } from '@scout/shared'

export type CatalogKind = 'skills' | 'plugins'

export interface CatalogEntry {
  id: string
  name: string
  description: string
  overview: string
  category: string
  categoryLabel: string
  source: string
  author: string
  identifier: string
  installIdentifier?: string | null
  repo: string
  sha: string
  subdir: string
  version: string
  requiresScout: string
  tags: string[]
  platforms: string[]
  requirements: string[]
  tools: string[]
  hooks: string[]
  middleware?: string[]
  commands?: string[]
  license?: string
  sourceUrl: string | null
  docsUrl: string | null
  /** Catalog-provided media, restricted to the same GitHub hosts as the website. */
  imageUrl: string | null
  screenshots?: string[]
  addedAt?: string
  updatedAt?: string
  stars: number | null
  search: string
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(v => typeof v === 'string') : [])

const IMAGE_HOSTS = new Set(['raw.githubusercontent.com', 'github.com'])

// URL.parse, not `new URL` in try/catch: most skill rows carry no repo or docs
// URL, and 200k thrown TypeErrors cost ~0.7s of main thread per catalog load.
const parseUrl = (value: unknown) => URL.parse(text(value))

/** Mirrors scripts/validate_plugin_catalog.py: https on a GitHub host, else no image. */
export function catalogImageUrl(value: unknown): string | null {
  const url = parseUrl(value)
  const host = url?.hostname.toLowerCase() ?? ''

  return url?.protocol === 'https:' && (IMAGE_HOSTS.has(host) || host.endsWith('.githubusercontent.com'))
    ? url.href
    : null
}

function webUrl(value: unknown): string | null {
  const url = parseUrl(value)

  return url?.protocol === 'https:' || url?.protocol === 'http:' ? url.href : null
}

/** Display form of a source or category id: domains stay verbatim (`browse.sh`),
 *  slugs read as words (`software-development` → `Software Development`). */
export const catalogLabel = (value: string) =>
  value.includes('.') ? value : value.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export function parseCatalog(kind: CatalogKind, data: unknown): CatalogEntry[] {
  if (!Array.isArray(data)) {
    throw new Error('Invalid catalog response')
  }

  const entries = new Map<string, CatalogEntry>()

  for (const row of data) {
    if (!row || typeof row !== 'object' || !text(row.name)) {
      continue
    }

    const name = text(row.name)
    const source = text(kind === 'plugins' ? row.tier : row.source)
    const identifier = text(row.identifier) || name
    const id = `${source}:${identifier}`
    const caps = row.capabilities ?? {}
    const category = text(row.category) || 'uncategorized'
    const categoryLabel = text(row.categoryLabel) || category
    const tags = strings(row.tags)
    const tools = strings(caps.providesTools)
    const hooks = strings(caps.providesHooks)
    const middleware = strings(caps.providesMiddleware)
    const commands = strings(row.commands)
    const platforms = strings(row.platforms)
    const requirements = strings(kind === 'plugins' ? caps.requiresEnv : row.envVars)
    const author = text(row.maintainer ?? row.author)
    const description = text(row.description)

    entries.set(id, {
      id,
      name,
      description,
      overview: text(row.overview),
      category,
      categoryLabel,
      source,
      author,
      identifier,
      installIdentifier:
        kind === 'skills'
          ? skillCatalogInstallIdentifier({
              name,
              source,
              identifier: text(row.identifier),
              installIdentifier: text(row.installIdentifier)
            })
          : null,
      repo: text(row.repo),
      sha: text(row.sha),
      subdir: text(row.subdir),
      version: text(row.version),
      requiresScout: text(row.requiresScout),
      tags,
      tools,
      hooks,
      middleware,
      commands,
      license: text(row.license) || undefined,
      platforms,
      requirements,
      sourceUrl: webUrl(row.repo || row.sourceUrl),
      docsUrl: webUrl(row.docsUrl),
      imageUrl: kind === 'plugins' ? catalogImageUrl(row.image) : null,
      screenshots:
        kind === 'plugins'
          ? strings(row.screenshots)
              .map(catalogImageUrl)
              .filter((url): url is string => url !== null)
          : [],
      addedAt: Number.isFinite(Date.parse(text(row.addedAt))) ? text(row.addedAt) : undefined,
      updatedAt: Number.isFinite(Date.parse(text(row.updatedAt))) ? text(row.updatedAt) : undefined,
      stars: typeof row.stars === 'number' && Number.isFinite(row.stars) ? row.stars : null,
      search: [
        name,
        description,
        text(row.overview),
        author,
        category,
        categoryLabel,
        source,
        ...tags,
        ...tools,
        ...hooks,
        ...platforms,
        ...requirements,
        ...commands,
        ...middleware
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    })
  }

  return [...entries.values()]
}
