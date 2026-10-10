export function isOnboardingEnabled(): boolean {
  return window.scoutDesktop?.guestOnboardingEnabled === true
}
