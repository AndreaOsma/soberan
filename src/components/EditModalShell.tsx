import { ReactNode } from "react";
import { GlassModal } from "./GlassModal";

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
};

export function EditModalShell({ title, onClose, children, maxWidth = "520px" }: Props) {
  return (
    <GlassModal isOpen onClose={onClose} title={title} maxWidth={maxWidth}>
      {children}
    </GlassModal>
  );
}
