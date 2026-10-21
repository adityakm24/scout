import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  label: string;
  value: T;
}

export interface SegmentedProps<T extends string> {
  className?: string;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "md" | "sm";
  value: T;
}

export function Segmented<T extends string>({ className, onChange, options, size = "sm", value }: SegmentedProps<T>) {
  return (
    <div
      className={cn("inline-flex rounded-full border border-midground/15 bg-background/30 p-1", className)}
      role="radiogroup"
    >
      {options.map((opt) => {
        const active = opt.value === value;

        return (
          <button
            aria-checked={active}
            className={cn(
              "cursor-pointer whitespace-nowrap rounded-full font-display text-display tracking-[0.1em] transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-midground/30",
              size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-3.5 text-xs",
              active ? "bg-midground text-background-base" : "text-text-secondary hover:bg-midground/10 hover:text-midground",
            )}
            key={opt.value}
            onClick={() => onChange(opt.value)}
            role="radio"
            type="button"
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterGroup({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="font-display text-xs text-display tracking-[0.12em] text-text-tertiary">{label}</span>
      {children}
    </div>
  );
}
