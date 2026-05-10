"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowSquareOut } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  href: string;
  icon: ReactNode;
  label: string;
  exact?: boolean;
  /** When true, opens in a new tab. The link is never marked as active in the
   *  sidebar (it's a side trip, not part of the main flow). */
  external?: boolean;
}

export function ControlPanelLink({
  href,
  icon,
  label,
  exact = false,
  external = false,
}: Props) {
  const pathname = usePathname();
  const active = external
    ? false
    : exact
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  const className = cn(
    "group flex items-center gap-3 px-4 py-2 text-[12px] tracking-[0.3px] transition-colors duration-150 border-l-[3px]",
    active
      ? "bg-[var(--copper-glow-soft)] text-[var(--forge-text-accent)] border-l-[var(--copper-glow)] font-semibold"
      : "text-[var(--forge-text)] border-l-transparent hover:bg-[var(--copper-glow-soft)]/40 hover:text-[var(--forge-text-accent)]",
  );

  const inner = (
    <>
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center transition-colors",
          active
            ? "text-[var(--copper-glow-strong)]"
            : "text-[var(--forge-text-muted)] group-hover:text-[var(--copper-glow)]",
        )}
      >
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {external ? (
        <ArrowSquareOut
          size={11}
          weight="bold"
          className="text-[var(--forge-text-dim)] group-hover:text-[var(--copper-glow)]"
        />
      ) : null}
    </>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {inner}
    </Link>
  );
}
