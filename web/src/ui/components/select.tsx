import { ChevronDown } from "lucide-react";
import { Children, type CSSProperties, isValidElement, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SelectOptionProps {
  children: ReactNode;
  value: string;
}

/** Declares one option of a `<Select>`; renders nothing by itself. */
export function SelectOption(_props: SelectOptionProps): null {
  return null;
}

export interface SelectProps {
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  style?: CSSProperties;
  value?: string;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** Native select styled to the theme: keyboard, screen-reader and mobile pickers come for free. */
export function Select({ children, className, disabled, id, onValueChange, placeholder, style, value }: SelectProps) {
  const options = Children.toArray(children).flatMap((child) =>
    isValidElement<SelectOptionProps>(child) && child.type === SelectOption
      ? [{ label: textOf(child.props.children), value: child.props.value }]
      : [],
  );
  const known = options.some((option) => option.value === value);

  return (
    <div className={cn("relative inline-flex w-full", className)} style={style}>
      <select
        className={cn(
          "h-9 w-full cursor-pointer appearance-none rounded-md border border-midground/15 bg-background/40 py-1 pl-3 pr-8 text-sm text-midground transition-colors",
          "focus-visible:border-midground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-midground/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        disabled={disabled}
        id={id}
        onChange={(event) => onValueChange?.(event.target.value)}
        value={known ? value : ""}
      >
        {!known && (
          <option disabled hidden value="">
            {placeholder ?? value ?? ""}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-secondary"
      />
    </div>
  );
}
