import React, { useId } from 'react';
import { createPortal } from 'react-dom';
import { useModalA11y } from '../hooks/useModalA11y';

interface GlassModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  contentClassName?: string;
  maxWidth?: string;
}

export const GlassModal: React.FC<GlassModalProps> = ({
  isOpen, onClose, title, children, contentClassName, maxWidth,
}) => {
  const titleId = useId();
  const panelRef = useModalA11y(isOpen, onClose, titleId);

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className={`modal-content modal-panel${contentClassName ? ` ${contentClassName}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={maxWidth ? { maxWidth, width: "100%" } : undefined}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
          &times;
        </button>
        <h2 id={titleId} className="modal-title">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
};
