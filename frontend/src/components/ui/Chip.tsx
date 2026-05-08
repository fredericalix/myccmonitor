"use client";

import { X } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ChipProps {
  children: ReactNode;
  onRemove?: () => void;
  className?: string;
  variant?: "default" | "accent";
}

export function Chip({
  children,
  onRemove,
  className,
  variant = "default",
}: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        variant === "accent"
          ? "bg-accent-soft text-accent-strong border border-accent/30"
          : "bg-surface text-text border border-border",
        className,
      )}
    >
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full p-0.5 text-text-muted hover:bg-bg hover:text-critical transition-colors"
          aria-label="Remove"
        >
          <X size={12} weight="bold" />
        </button>
      ) : null}
    </span>
  );
}
