import { TriangleAlert } from "lucide-react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { useRef } from "react";

import { Button } from "./button";

export interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel?: string;
  description?: string;
  destructive?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
}

export function ConfirmDialog({
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  description,
  destructive = false,
  loading = false,
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
  // A confirm closes the dialog too; only a dismissal counts as a cancel.
  const confirmedRef = useRef(false);

  return (
    <AlertDialogPrimitive.Root
      onOpenChange={(next) => {
        if (!next && !confirmedRef.current) onCancel();
        confirmedRef.current = false;
      }}
      open={open}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          style={{ animation: "backdrop-in 150ms ease-out" }}
        />
        <AlertDialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-midground/15 bg-background-base text-midground shadow-xl outline-none"
          style={{ animation: "dialog-in 150ms ease-out" }}
        >
          <div className="flex items-start gap-3 border-b border-midground/15 p-4">
            {destructive && <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <AlertDialogPrimitive.Title className="font-display-wide text-sm font-bold uppercase tracking-[0.08em]">
                {title}
              </AlertDialogPrimitive.Title>
              {description ? (
                <AlertDialogPrimitive.Description className="text-sm text-text-secondary">
                  {description}
                </AlertDialogPrimitive.Description>
              ) : (
                <AlertDialogPrimitive.Description className="sr-only">{title}</AlertDialogPrimitive.Description>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 p-4">
            <AlertDialogPrimitive.Cancel asChild>
              <Button disabled={loading} outlined size="sm" type="button">
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button
                destructive={destructive}
                disabled={loading}
                onClick={() => {
                  confirmedRef.current = true;
                  onConfirm();
                }}
                size="sm"
                type="button"
              >
                {loading ? "…" : confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
