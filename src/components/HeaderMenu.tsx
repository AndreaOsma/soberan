import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Menú desplegable de la cabecera: botón + lista. Esc o tocar fuera lo cierran y el foco vuelve al
 *  botón (UXGuide). `children` recibe `close` para cerrar al elegir. */
export function HeaderMenu({
  label,
  icon,
  className = "",
  children,
}: {
  label: string;
  icon: ReactNode;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
  return (
    <div className={`header-menu ${className}`} ref={wrap}>
      <button
        ref={button}
        type="button"
        className="header-menu__trigger"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && (
        <div id={id} className="header-menu__list" role="menu" aria-label={label}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
