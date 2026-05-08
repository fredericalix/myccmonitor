"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SidebarItemProps {
  href: string;
  icon: ReactNode;
  label: string;
  exact?: boolean;
}

export function SidebarItem({ href, icon, label, exact = false }: SidebarItemProps) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150",
        active
          ? "bg-accent-soft text-accent-strong"
          : "text-text-muted hover:bg-accent-soft/50 hover:text-text",
      )}
    >
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center transition-transform duration-150",
          active && "scale-110",
        )}
      >
        {icon}
      </span>
      <span>{label}</span>
      {active ? (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
      ) : null}
    </Link>
  );
}
