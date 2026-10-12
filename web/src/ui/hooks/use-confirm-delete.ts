import { useCallback, useState } from "react";

/** State for a confirm-before-delete dialog. A failed delete keeps the dialog open. */
export function useConfirmDelete<TId>({ onDelete }: { onDelete: (id: TId) => Promise<void> }) {
  const [pendingId, setPendingId] = useState<TId | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const requestDelete = useCallback((id: TId) => setPendingId(id), []);

  const cancel = useCallback(() => {
    if (!isDeleting) setPendingId(null);
  }, [isDeleting]);

  const confirm = useCallback(async () => {
    if (pendingId === null) return;
    setIsDeleting(true);
    try {
      await onDelete(pendingId);
      setPendingId(null);
    } catch {
      // onDelete surfaces its own error; the dialog stays open for a retry.
    } finally {
      setIsDeleting(false);
    }
  }, [onDelete, pendingId]);

  return { cancel, confirm, isDeleting, isOpen: pendingId !== null, pendingId, requestDelete } as const;
}
