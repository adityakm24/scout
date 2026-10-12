import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

type StatPart = string | { key: string; node: ReactNode };

export interface StatsProps extends ComponentProps<"div"> {
  /** Put the label first and the value last (default: value first). */
  flip?: boolean;
  items: { label: StatPart; value: StatPart }[];
}

const keyOf = (part: StatPart) => (typeof part === "string" ? part : part.key);
const nodeOf = (part: StatPart) => (typeof part === "string" ? part : part.node);

/** Label/value rows joined by a dotted leader. */
export function Stats({ className, flip = false, items, ...props }: StatsProps) {
  return (
    <div className={cn("flex w-full flex-col gap-4", className)} {...props}>
      {items.map(({ label, value }) => {
        const valueText = <span className="text-xs leading-snug tracking-widest">{nodeOf(value)}</span>;
        const labelText = <span className="font-mono leading-none tracking-[0.2em] opacity-60">{nodeOf(label)}</span>;

        return (
          <div
            className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 text-display text-midground"
            key={`${keyOf(label)}@@${keyOf(value)}`}
          >
            {flip ? labelText : valueText}
            <span aria-hidden className="min-w-0 border-b border-dotted border-midground/25" />
            {flip ? valueText : labelText}
          </div>
        );
      })}
    </div>
  );
}
