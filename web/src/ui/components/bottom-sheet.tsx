import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

export interface BottomSheetProps {
  backdropDismissLabel?: string;
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
}

/** Mobile bottom sheet: portaled, Escape/backdrop dismiss, body scroll lock. */
export function BottomSheet({ backdropDismissLabel = "Close", children, onClose, open, title }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label={backdropDismissLabel}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        style={{ animation: "backdrop-in 200ms ease-out" }}
        type="button"
      />
      <div
        aria-label={title}
        aria-modal="true"
        className="relative flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-midground/15 bg-background-base pb-[env(safe-area-inset-bottom)] text-midground shadow-2xl motion-reduce:animate-none"
        role="dialog"
        style={{ animation: "sheet-in 220ms cubic-bezier(0.32, 0.72, 0, 1)" }}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-midground/25" />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
