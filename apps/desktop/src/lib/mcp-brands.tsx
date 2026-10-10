/**
 * Curated brand glyphs for MCP server names — extracted from the mcp-tab's
 * avatar (its `MCP_BRAND_ICONS`) the moment a second surface (the composer
 * suggestion pills / inline setup card) needed the same identity ladder.
 *
 * This is the first rung only. Everything below it — the endpoint's own
 * favicon, then the initial — lives in `components/ui/connector-logo`, which
 * is what a surface should render when it wants a mark rather than a glyph.
 * Either way we never ask a third-party favicon service: an MCP URL can be a
 * private host, and that lookup would leak the hostname off-box.
 */
import {
  SiAirtable,
  SiAsana,
  SiAtlassian,
  SiCalendly,
  SiDatadog,
  SiDiscord,
  SiDropbox,
  SiFigma,
  SiGithub,
  SiGitlab,
  SiGmail,
  SiGooglecalendar,
  SiGoogledrive,
  SiGooglesheets,
  SiHuggingface,
  SiIntercom,
  SiJira,
  SiLinear,
  SiN8n,
  SiNetlify,
  SiNotion,
  SiPaypal,
  SiPostgresql,
  SiSentry,
  SiSpotify,
  SiSquare,
  SiStrava,
  SiStripe,
  SiSupabase,
  SiSwiggy,
  SiTelegram,
  SiTodoist,
  SiUnrealengine,
  SiVercel,
  SiWebflow,
  SiYoutube,
  SiZapier
} from '@icons-pack/react-simple-icons'
import { IconBrandSlack } from '@tabler/icons-react'
import type { ComponentType, SVGProps } from 'react'

export interface McpBrand {
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  color: string
  /** The official mark is black/white (GitHub, Vercel, Notion): render it in
   *  `currentColor` so it follows the theme instead of vanishing on dark. The
   *  `color` stays for tint backgrounds (the avatar chip), never the glyph. */
  monochrome?: boolean
}

export const MCP_BRAND_ICONS: Record<string, McpBrand> = {
  airtable: { Icon: SiAirtable, color: '#18BFFF' },
  asana: { Icon: SiAsana, color: '#F06A6A' },
  atlassian: { Icon: SiAtlassian, color: '#0052CC' },
  calendly: { Icon: SiCalendly, color: '#006BFF' },
  datadog: { Icon: SiDatadog, color: '#632CA6' },
  discord: { Icon: SiDiscord, color: '#5865F2' },
  dropbox: { Icon: SiDropbox, color: '#0061FF' },
  figma: { Icon: SiFigma, color: '#F24E1E' },
  github: { Icon: SiGithub, color: '#181717', monochrome: true },
  gitlab: { Icon: SiGitlab, color: '#FC6D26' },
  gmail: { Icon: SiGmail, color: '#EA4335' },
  // Gateway spelling (connector slugs), plus the hyphenated form MCP server
  // names tend to use.
  googlecalendar: { Icon: SiGooglecalendar, color: '#4285F4' },
  'google-calendar': { Icon: SiGooglecalendar, color: '#4285F4' },
  googledrive: { Icon: SiGoogledrive, color: '#4285F4' },
  'google-drive': { Icon: SiGoogledrive, color: '#4285F4' },
  googlesheets: { Icon: SiGooglesheets, color: '#34A853' },
  hugging_face: { Icon: SiHuggingface, color: '#FFD21E' },
  huggingface: { Icon: SiHuggingface, color: '#FFD21E' },
  intercom: { Icon: SiIntercom, color: '#6AFDEF' },
  jira: { Icon: SiJira, color: '#0052CC' },
  linear: { Icon: SiLinear, color: '#5E6AD2' },
  n8n: { Icon: SiN8n, color: '#EA4B71' },
  netlify: { Icon: SiNetlify, color: '#00C7B7' },
  notion: { Icon: SiNotion, color: '#000000', monochrome: true },
  paypal: { Icon: SiPaypal, color: '#003087' },
  postgres: { Icon: SiPostgresql, color: '#4169E1' },
  postgresql: { Icon: SiPostgresql, color: '#4169E1' },
  sentry: { Icon: SiSentry, color: '#362D59' },
  // simple-icons dropped Slack's mark on a trademark request and the site's
  // favicon is a flat purple square that reads as a blank disc at chip size.
  // Tabler's outline pinwheel is the one recognisable Slack we can ship.
  slack: { Icon: IconBrandSlack as ComponentType<SVGProps<SVGSVGElement>>, color: '#4A154B', monochrome: true },
  spotify: { Icon: SiSpotify, color: '#1DB954' },
  square: { Icon: SiSquare, color: '#3E4348', monochrome: true },
  strava: { Icon: SiStrava, color: '#FC4C02' },
  stripe: { Icon: SiStripe, color: '#635BFF' },
  supabase: { Icon: SiSupabase, color: '#3FCF8E' },
  swiggy: { Icon: SiSwiggy, color: '#FC8019' },
  telegram: { Icon: SiTelegram, color: '#26A5E4' },
  todoist: { Icon: SiTodoist, color: '#E44332' },
  'unreal-engine': { Icon: SiUnrealengine, color: '#0E1128', monochrome: true },
  vercel: { Icon: SiVercel, color: '#000000', monochrome: true },
  webflow: { Icon: SiWebflow, color: '#146EF5' },
  youtube: { Icon: SiYoutube, color: '#FF0000' },
  zapier: { Icon: SiZapier, color: '#FF4A00' }
}

/** Inline-glyph color for a brand: monochrome marks inherit the surrounding
 *  text color; branded marks use the brand color. */
export const brandGlyphStyle = (brand: McpBrand): { color: string } | undefined =>
  brand.monochrome ? undefined : { color: brand.color }

/** The same brand under every spelling a connector arrives with: catalog slug
 *  (`unreal-engine`), registry id (`unreal_engine`), display name (`Unreal
 *  Engine`). Compare on letters and digits alone so none of them miss. */
const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

export const brandFor = (name: string): McpBrand | null => {
  const target = squash(name)

  if (!target) {
    return null
  }

  const entries = Object.entries(MCP_BRAND_ICONS)

  return (
    entries.find(([key]) => squash(key) === target)?.[1] ??
    entries.find(([key]) => target.includes(squash(key)))?.[1] ??
    null
  )
}
