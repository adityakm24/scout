import { type HTMLAttributes, useEffect, useState } from "react";
import spinners, { type BrailleSpinnerName } from "unicode-animations";

import { cn } from "@/lib/utils";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  name?: BrailleSpinnerName;
}

/** Braille text spinner. Inherits colour and size from its parent; decorative unless given an aria-label. */
export function Spinner({ className, name = "braille", ...props }: SpinnerProps) {
  const animation = spinners[name];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % animation.frames.length), animation.interval);
    return () => clearInterval(id);
  }, [animation.frames.length, animation.interval]);

  return (
    <span
      aria-hidden={props["aria-label"] ? undefined : true}
      className={cn("inline-block font-mono leading-none tabular-nums", className)}
      {...props}
    >
      {animation.frames[frame]}
    </span>
  );
}
