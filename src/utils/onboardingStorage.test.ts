import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ONBOARDING_DONE_LS,
  isOnboardingMarkedDone,
  persistOnboardingDoneLocal,
  readOnboardingDoneLocal,
} from "./onboardingStorage";

// See dataCache.test.ts: plain Node test environment has no global localStorage.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe("onboardingStorage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("readOnboardingDoneLocal es false hasta persistir", () => {
    expect(readOnboardingDoneLocal()).toBe(false);
    persistOnboardingDoneLocal();
    expect(readOnboardingDoneLocal()).toBe(true);
    expect(localStorage.getItem(ONBOARDING_DONE_LS)).toBe("true");
  });

  it("isOnboardingMarkedDone es true si el backend lo dice", () => {
    expect(isOnboardingMarkedDone({ onboarding_done: "true" })).toBe(true);
  });

  it("isOnboardingMarkedDone es true si solo el local storage lo dice", () => {
    persistOnboardingDoneLocal();
    expect(isOnboardingMarkedDone({})).toBe(true);
  });

  it("isOnboardingMarkedDone es false si ninguno lo dice", () => {
    expect(isOnboardingMarkedDone({})).toBe(false);
    expect(isOnboardingMarkedDone({ onboarding_done: "false" })).toBe(false);
  });
});
