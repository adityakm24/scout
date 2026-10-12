import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Tone = "default" | "destructive" | "outline" | "secondary" | "success" | "warning";

const TONE: Record<Tone, string> = {
  default: "border-midground/20 bg-midground/10 text-midground",
  destructive: "border-destructive/30 bg-destructive/15 text-destructive",
  outline: "border-midground/30 bg-transparent text-midground/80",
  secondary: "border-midground/15 bg-midground/5 text-midground",
  success: "border-success/30 bg-success/15 text-success",
  warning: "border-warning/30 bg-warning/15 text-warning",
};

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "color"> {
  tone?: Tone;
}

export function Badge({ className, tone = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-1 text-xs font-semibold leading-none text-display tracking-[0.12em]",
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
