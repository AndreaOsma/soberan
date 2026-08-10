import { useEffect, useRef } from "react";

const FIELD_SELECTOR =
  "input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled])";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

function getInitialFocus(panel: HTMLElement): HTMLElement | null {
  const autofocus = panel.querySelector<HTMLElement>("[autofocus]");
  if (autofocus && !autofocus.hasAttribute("disabled")) return autofocus;

  const field = panel.querySelector<HTMLElement>(FIELD_SELECTOR);
  if (field) return field;

  return panel.querySelector<HTMLElement>(
    'button:not(.modal-close):not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  );
}

export function useModalA11y(isOpen: boolean, onClose: () => void, _titleId: string) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first || !panel.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !panel.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEsc);
    window.addEventListener("keydown", handleTab);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleEsc);
      window.removeEventListener("keydown", handleTab);
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    getInitialFocus(panel)?.focus();
  }, [isOpen]);

  return panelRef;
}
