import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type ButtonSize = "default" | "icon" | "sm" | "xs";

const SIZE: Record<ButtonSize, string> = {
  default: "h-9 px-4 text-xs",
  icon: "size-9 p-0 [&>svg]:size-4",
  sm: "h-8 px-3 text-[0.7rem] [&>svg]:size-3.5",
  xs: "size-6 p-0 [&>svg]:size-3",
};

function surface({ destructive, ghost, invert, outlined }: Variant): string {
  if (destructive) {
    if (ghost) return "bg-transparent text-destructive hover:bg-destructive/10";
    if (outlined) return "border border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10";
    return "bg-destructive text-destructive-foreground hover:bg-destructive/90";
  }
  if (ghost) return "bg-transparent text-current hover:bg-midground/10";
  if (outlined) return "border border-midground/35 bg-transparent text-midground hover:bg-midground/10";
  if (invert) return "bg-midground/15 text-midground hover:bg-midground/25";
  return "bg-midground text-background-base hover:bg-midground/90";
}

interface Variant {
  destructive?: boolean | null;
  ghost?: boolean | null;
  invert?: boolean | null;
  outlined?: boolean | null;
}

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "prefix" | "suffix">, Variant {
  prefix?: ReactNode;
  size?: ButtonSize | null;
  suffix?: ReactNode;
}

export function Button({
  children,
  className,
  destructive,
  ghost,
  invert,
  outlined,
  prefix,
  size,
  suffix,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold text-display tracking-[0.12em] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-midground/40",
        "disabled:pointer-events-none disabled:opacity-50",
        SIZE[size ?? "default"],
        surface({ destructive, ghost, invert, outlined }),
        className,
      )}
      {...props}
    >
      {prefix}
      {children}
      {suffix}
    </button>
  );
}
