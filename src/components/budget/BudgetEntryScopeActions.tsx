import { useEffect, useId, useRef, useState } from "react";

type Props = {
  onThisMonth: () => void;
  onFollowing: () => void;
  monthLabel: string;
  entryLabel?: string;
  disabled?: boolean;
};

export function BudgetEntryScopeActions({
  onThisMonth,
  onFollowing,
  monthLabel,
  entryLabel = "partida",
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="budget-sub-remove" ref={rootRef}>
      <button
        type="button"
        className="danger budget-sub-remove__trigger"
        disabled={disabled}
        aria-label={`Borrar ${entryLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={`Borrar ${entryLabel}`}
        onClick={() => setOpen((v) => !v)}
      >
        🗑
      </button>
      {open && (
        <div className="budget-sub-remove__menu" id={menuId} role="menu">
          <button
            type="button"
            role="menuitem"
            className="button-secondary"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onThisMonth();
            }}
          >
            Solo este mes ({monthLabel})
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onFollowing();
            }}
          >
            Este mes y siguientes
          </button>
        </div>
      )}
    </div>
  );
}
