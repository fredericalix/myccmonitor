"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  href: string;
  icon: ReactNode;
  label: string;
  exact?: boolean;
}

export function ControlPanelLink({ href, icon, label, exact = false }: Props) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 px-4 py-2 text-[12px] tracking-[0.3px] transition-colors duration-150 border-l-[3px]",
        active
          ? "bg-[var(--copper-glow-soft)] text-[var(--forge-text-accent)] border-l-[var(--copper-glow)] font-semibold"
          : "text-[var(--forge-text)] border-l-transparent hover:bg-[var(--copper-glow-soft)]/40 hover:text-[var(--forge-text-accent)]",
      )}
    >
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
      <span>{label}</span>
    </Link>
  );
}
