import * as React from "react";

import { cn } from "@/lib/utils";

export function LogoOneC({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 72 40"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <rect width="72" height="40" rx="6" fill="#ffdd2d" />
      <text
        x="36"
        y="27"
        textAnchor="middle"
        fill="#d92228"
        fontFamily="system-ui, sans-serif"
        fontSize="18"
        fontWeight="800"
      >
        1С
      </text>
    </svg>
  );
}

export function LogoYespos({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 40"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="yesposG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
      <rect width="120" height="40" rx="6" fill="url(#yesposG)" />
      <text
        x="60"
        y="26"
        textAnchor="middle"
        fill="#ffffff"
        fontFamily="system-ui, sans-serif"
        fontSize="14"
        fontWeight="800"
        letterSpacing="0.08em"
      >
        YESPOS
      </text>
    </svg>
  );
}

export function LogoIbox({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 40"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <rect width="96" height="40" rx="6" fill="#0f172a" />
      <rect x="8" y="10" width="16" height="20" rx="2" fill="#38bdf8" opacity="0.35" />
      <rect x="11" y="13" width="10" height="6" rx="1" fill="#e2e8f0" />
      <text
        x="54"
        y="26"
        textAnchor="middle"
        fill="#f8fafc"
        fontFamily="system-ui, sans-serif"
        fontSize="15"
        fontWeight="800"
        letterSpacing="0.12em"
      >
        IBOX
      </text>
    </svg>
  );
}
