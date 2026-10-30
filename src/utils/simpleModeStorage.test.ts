import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIMPLE_MODE_LS, persistSimpleModeLocal, readSimpleModeLocal } from "./simpleModeStorage";

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

describe("simpleModeStorage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("por defecto es modo completo", () => {
    expect(readSimpleModeLocal()).toBe(false);
  });

  it("recuerda la preferencia activada y desactivada", () => {
    persistSimpleModeLocal(true);
    expect(localStorage.getItem(SIMPLE_MODE_LS)).toBe("true");
    expect(readSimpleModeLocal()).toBe(true);
    persistSimpleModeLocal(false);
    expect(readSimpleModeLocal()).toBe(false);
  });

  it("ignora valores desconocidos", () => {
    localStorage.setItem(SIMPLE_MODE_LS, "yes");
    expect(readSimpleModeLocal()).toBe(false);
  });

  it("no falla si localStorage no está disponible", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    });
    expect(readSimpleModeLocal()).toBe(false);
    expect(() => persistSimpleModeLocal(true)).not.toThrow();
  });
});
