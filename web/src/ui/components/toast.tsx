import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export interface ToastMessage {
  message: string;
  type: "error" | "success";
}

/** Top-right status toast driven by `useToast`; fades out when `toast` clears. */
export function Toast({ toast }: { toast: ToastMessage | null }) {
  const [current, setCurrent] = useState(toast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (toast) {
      setCurrent(toast);
      setVisible(true);
      return;
    }
    setVisible(false);
    const timer = setTimeout(() => setCurrent(null), 200);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!current || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-live="polite"
      className={cn(
        "fixed right-4 top-16 z-50 rounded-md border px-4 py-2.5 text-xs backdrop-blur-sm",
        current.type === "success"
          ? "border-success/30 bg-success/15 text-success"
          : "border-destructive/30 bg-destructive/15 text-destructive",
      )}
      role="status"
      style={{ animation: visible ? "toast-in 200ms ease-out forwards" : "toast-out 200ms ease-in forwards" }}
    >
      {current.message}
    </div>,
    document.body,
  );
}
