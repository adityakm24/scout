const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/**
 * Resolve the active Expo account username dynamically so team members don't
 * collide on a single hardcoded `owner` in app.json.
 *
 * Resolution order:
 *   1. EXPO_OWNER environment variable (explicit override / CI)
 *   2. Logged-in Expo CLI user in ~/.expo/state.json (`auth.username`)
 *   3. Undefined — Expo CLI falls back to the currently authenticated session
 */
function resolveExpoOwner() {
  const envOwner = process.env.EXPO_OWNER?.trim()
  if (envOwner) {
    return envOwner
  }

  try {
    const statePath = path.join(os.homedir(), '.expo', 'state.json')
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    const username = state?.auth?.username?.trim()
    if (username) {
      return username
    }
  } catch {
    // No local ~/.expo/state.json or unauthenticated — let Expo resolve from session
  }

  return undefined
}

/** @param {import('expo/config').ConfigContext} ctx */
module.exports = ({ config }) => {
  const owner = resolveExpoOwner()
  const projectId = process.env.EAS_PROJECT_ID?.trim() || config.extra?.eas?.projectId

  return {
    ...config,
    ...(owner ? { owner } : {}),
    extra: {
      ...config.extra,
      ...(projectId
        ? {
            eas: {
              ...config.extra?.eas,
              projectId
            }
          }
        : {})
    }
  }
}
