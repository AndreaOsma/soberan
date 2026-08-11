import { describe, expect, it } from "vitest";
import { isWishlistActive, isWishlistArchived } from "./wishlist";
import type { WishlistItem } from "../types";

function item(partial: Partial<WishlistItem> = {}): WishlistItem {
  return {
    id: 1,
    nombre: "Test",
    prioridad: "media",
    comprado: false,
    ...partial,
  };
}

describe("wishlist helpers", () => {
  it("activo por defecto", () => {
    expect(isWishlistActive(item())).toBe(true);
    expect(isWishlistArchived(item())).toBe(false);
  });

  it("archivado cuando comprado o archivado", () => {
    expect(isWishlistArchived(item({ comprado: true }))).toBe(true);
    expect(isWishlistArchived(item({ archivado: true }))).toBe(true);
    expect(isWishlistActive(item({ archivado: true }))).toBe(false);
  });
});
