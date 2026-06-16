import * as React from "react";

import { cn } from "@/lib/utils";

type LogoOctopusProps = {
  className?: string;
  /** Pixel size (square). */
  size?: number;
};

export function LogoOctopus({
  className,
  size = 48,
}: LogoOctopusProps) {
  return (
    <img
      src="/octopus-logo.png"
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      alt="UPOS Finance Logo"
    />
  );
}
