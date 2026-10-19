import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasCachedSnapshot, markCachedSnapshot, readCache, writeCache } from "./dataCache";

// vitest runs these utils tests under Vite's "node" test environment (no jsdom, see
// vite.config.ts) — plain Node (this app targets Node 20, see Dockerfile) has no global
// localStorage, so it's stubbed per-test rather than relying on a browser-only global.
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

describe("dataCache", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("readCache devuelve el fallback si no hay nada guardado", () => {
    expect(readCache("accounts", [])).toEqual([]);
    expect(readCache("count", 0)).toBe(0);
  });

  it("writeCache + readCache hacen round-trip", () => {
    writeCache("accounts", [{ id: 1 }]);
    expect(readCache("accounts", [])).toEqual([{ id: 1 }]);
  });

  it("readCache devuelve el fallback si el JSON guardado está corrupto", () => {
    localStorage.setItem("soberan-cache-v1:accounts", "{not json");
    expect(readCache("accounts", ["fallback"])).toEqual(["fallback"]);
  });

  it("hasCachedSnapshot es false hasta que markCachedSnapshot se llama", () => {
    expect(hasCachedSnapshot()).toBe(false);
    markCachedSnapshot();
    expect(hasCachedSnapshot()).toBe(true);
  });
});
