import { Check, Minus } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";

import { cn } from "@/lib/utils";

export const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer flex size-4 shrink-0 cursor-pointer items-center justify-center rounded border outline-none transition-colors",
        "focus-visible:ring-1 focus-visible:ring-midground/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=unchecked]:border-midground/25 data-[state=unchecked]:bg-background data-[state=unchecked]:hover:border-midground/40",
        "data-[state=checked]:border-midground data-[state=checked]:bg-midground data-[state=checked]:text-background-base",
        "data-[state=indeterminate]:border-midground data-[state=indeterminate]:bg-midground data-[state=indeterminate]:text-background-base",
        className,
      )}
      ref={ref}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="group flex items-center justify-center">
        <Check className="size-3 group-data-[state=indeterminate]:hidden" strokeWidth={3} />
        <Minus className="hidden size-3 group-data-[state=indeterminate]:block" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
