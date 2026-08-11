import type { WishlistItem } from "../types";

export function isWishlistArchived(item: WishlistItem): boolean {
  return item.archivado === true || item.comprado === true;
}

export function isWishlistActive(item: WishlistItem): boolean {
  return !isWishlistArchived(item);
}
