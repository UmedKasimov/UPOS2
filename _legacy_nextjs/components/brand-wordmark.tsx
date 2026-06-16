import Link from "next/link";

import { LogoOctopus } from "@/components/logo-octopus";

export function BrandWordmark({
  href,
  subtitle,
}: {
  href?: string;
  subtitle?: string;
}) {
  const body = (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <LogoOctopus
          size={52}
          className="drop-shadow-[0_6px_16px_rgba(45,108,223,0.35)]"
        />
        <span className="text-foreground text-xl font-extrabold tracking-tight">
          UPOS{" "}
          <span className="text-[var(--brand-accent)] tracking-[0.06em] uppercase">
            Finance
          </span>
        </span>
      </div>
      {subtitle ? (
        <p className="text-muted-foreground max-w-[280px] text-xs leading-snug">
          {subtitle}
        </p>
      ) : null}
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label="UPOS Finance — на главную"
        className="focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2"
      >
        {body}
      </Link>
    );
  }

  return body;
}
