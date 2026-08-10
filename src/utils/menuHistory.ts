import { ALL_MENU_KEYS, type MenuKey } from "../config/ui";

export function isMenuKey(value: string | null | undefined): value is MenuKey {
  return Boolean(value && (ALL_MENU_KEYS as readonly string[]).includes(value));
}

export function parseMenuFromSearch(search: string = window.location.search): MenuKey | null {
  const raw = new URLSearchParams(search).get("menu");
  return isMenuKey(raw) ? raw : null;
}

/** Build path+query+hash with ?menu= (omit for home Resumen Ejecutivo). */
export function menuUrl(menu: MenuKey, href: string = window.location.href): string {
  const url = new URL(href);
  if (menu === "Resumen Ejecutivo") {
    url.searchParams.delete("menu");
  } else {
    url.searchParams.set("menu", menu);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function syncMenuHistory(
  menu: MenuKey,
  mode: "push" | "replace" = "push",
): void {
  const next = menuUrl(menu);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current && mode === "push") {
    // Still attach state for popstate consumers
    window.history.replaceState({ menu }, "", next);
    return;
  }
  if (mode === "replace") {
    window.history.replaceState({ menu }, "", next);
  } else {
    window.history.pushState({ menu }, "", next);
  }
}

export function menuFromPopState(event: PopStateEvent): MenuKey | null {
  const fromState = event.state && typeof event.state === "object" && "menu" in event.state
    ? String((event.state as { menu?: unknown }).menu ?? "")
    : null;
  if (isMenuKey(fromState)) return fromState;
  return parseMenuFromSearch();
}
