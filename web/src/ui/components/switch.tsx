import { type ButtonHTMLAttributes, forwardRef } from "react";

import { cn } from "@/lib/utils";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, className, disabled, onCheckedChange, ...props },
  ref,
) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        "peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-midground/25 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-midground/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-midground" : "bg-midground/10",
        className,
      )}
      data-state={checked ? "checked" : "unchecked"}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      ref={ref}
      role="switch"
      type="button"
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block size-3.5 rounded-full shadow-sm transition-transform",
          checked ? "translate-x-[1.15rem] bg-background-base" : "translate-x-0.5 bg-midground",
        )}
      />
    </button>
  );
});
