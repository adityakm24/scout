import { type ComponentPropsWithoutRef, type ElementType, forwardRef } from "react";

import { cn } from "@/lib/utils";

type Variant = "lg" | "md" | "sm" | "xl";

const SIZE: Record<Variant, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-2xl",
};

interface TypeProps {
  /** Display face (chrome headings). */
  display?: boolean;
  mono?: boolean;
  variant?: Variant;
}

function typeClass({ display, mono, variant }: TypeProps, className?: string) {
  return cn(display && "font-display", mono && "font-mono", variant && SIZE[variant], className);
}

export type TypographyProps<T extends ElementType = "span"> = TypeProps & { as?: T } & Omit<
    ComponentPropsWithoutRef<T>,
    keyof TypeProps | "as"
  >;

/** Polymorphic text element (a `<span>` by default). */
export function Typography<T extends ElementType = "span">({
  as,
  className,
  display,
  mono,
  variant,
  ...props
}: TypographyProps<T>) {
  const Tag: ElementType = as ?? "span";

  return <Tag className={typeClass({ display, mono, variant }, className)} {...props} />;
}

export const H2 = forwardRef<HTMLHeadingElement, TypeProps & ComponentPropsWithoutRef<"h2">>(function H2(
  { className, display, mono, variant = "lg", ...props },
  ref,
) {
  return (
    <h2
      className={typeClass({ display, mono, variant }, cn("font-bold tracking-wide", className))}
      ref={ref}
      {...props}
    />
  );
});
