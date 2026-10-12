const GUEST_ONBOARDING_ENV = 'SCOUT_GUEST_ONBOARDING'
const GUEST_ONBOARDING_FLAG = '--guest-onboarding'

export function guestOnboardingEnabled(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[GUEST_ONBOARDING_ENV] === '1' || argv.includes(GUEST_ONBOARDING_FLAG)
}
