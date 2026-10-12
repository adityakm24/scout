import { useCallback, useEffect, useRef, useState } from "react";

import type { ToastMessage } from "../components/toast";

/** Transient success/error message for `<Toast>`; clears itself after `duration` ms. */
export function useToast(duration = 3000) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const showToast = useCallback(
    (message: string, type: ToastMessage["type"]) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, type });
      timer.current = setTimeout(() => setToast(null), duration);
    },
    [duration],
  );

  return { showToast, toast };
}
