import { type ReactNode, useCallback, useState } from "react";

import { cn } from "@/lib/utils";

export interface CopyButtonProps {
  children?: ReactNode;
  className?: string;
  copiedLabel?: string;
  label?: string;
  resetDelayMs?: number;
  text: string;
}

/** Copy-to-clipboard text button that briefly confirms the copy. */
export function CopyButton({
  children,
  className,
  copiedLabel = "Copied!",
  label = "Copy",
  resetDelayMs = 2000,
  text,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), resetDelayMs);
    });
  }, [resetDelayMs, text]);

  return (
    <button
      className={cn(
        "flex cursor-pointer items-center justify-center border-none bg-transparent font-mono text-xs text-display tracking-widest transition-colors hover:text-midground",
        copied ? "text-midground" : "text-text-secondary",
        className,
      )}
      onClick={copy}
      type="button"
    >
      {children ?? (copied ? copiedLabel : label)}
    </button>
  );
}

/** A labelled, copyable command for install/setup instructions. */
export function CommandBlock({ className, code, label }: { className?: string; code: string; label: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between">
        <small className="text-xs opacity-60">{label}</small>
        <CopyButton text={code} />
      </div>
      <div className="rounded-md border border-current/20 bg-background/40 px-3 py-2 font-mono text-[0.6875rem] leading-relaxed">
        <code className="break-all">{code}</code>
      </div>
    </div>
  );
}
