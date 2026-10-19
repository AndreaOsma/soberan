export const ONBOARDING_DONE_LS = "soberan-onboarding-done";

export function readOnboardingDoneLocal(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_DONE_LS) === "true";
  } catch {
    return false;
  }
}

export function persistOnboardingDoneLocal(): void {
  try {
    localStorage.setItem(ONBOARDING_DONE_LS, "true");
  } catch {
    // ignore quota / private mode
  }
}

export function isOnboardingMarkedDone(settings: Record<string, string>): boolean {
  return settings.onboarding_done === "true" || readOnboardingDoneLocal();
}
