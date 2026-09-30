export function platformDefaultScoutHome(
  home: string,
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): string

export function resolveDesktopUserData(defaultPath: string, env?: NodeJS.ProcessEnv): string

export interface ScoutHomeOptions {
  home: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  directoryExists?: (directory: string) => boolean
  readWindowsHome?: () => string | null
}

export function resolveDesktopScoutHome(options: ScoutHomeOptions): string
