export const SIMPLE_MODE_LS = "soberan-simple-mode";

export function readSimpleModeLocal(): boolean {
  try {
    return localStorage.getItem(SIMPLE_MODE_LS) === "true";
  } catch {
    return false;
  }
}

export function persistSimpleModeLocal(value: boolean): void {
  try {
    localStorage.setItem(SIMPLE_MODE_LS, value ? "true" : "false");
  } catch {
    // ignore quota / private mode
  }
}
