import { type ButtonHTMLAttributes, forwardRef } from "react";

import { cn } from "@/lib/utils";

export interface ListItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export const ListItem = forwardRef<HTMLButtonElement, ListItemProps>(function ListItem(
  { active = false, className, type = "button", ...props },
  ref,
) {
  return (
    <button
      className={cn(
        "group relative flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-midground/30",
        "disabled:cursor-not-allowed disabled:text-text-disabled",
        active ? "bg-midground/10 text-midground" : "text-text-secondary hover:bg-midground/5 hover:text-midground",
        className,
      )}
      data-active={active || undefined}
      ref={ref}
      type={type}
      {...props}
    />
  );
});
