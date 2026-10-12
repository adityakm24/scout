import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-midground/15 bg-background/40 px-3 py-1 font-mono text-sm transition-colors",
        "placeholder:text-midground/50",
        "focus-visible:border-midground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-midground/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
