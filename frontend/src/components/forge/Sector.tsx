import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Sector({
  label,
  count,
  icon,
  children,
  className,
}: {
  label: string;
  count?: number;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[1.5px] text-[var(--forge-text-dim)]">
        {icon ? <span className="text-[var(--copper-glow)]">{icon}</span> : null}
        <span>{label}</span>
        {count !== undefined ? (
          <span className="rounded border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--forge-text-accent)]">
            {count}
          </span>
        ) : null}
        <span
          aria-hidden
          className="ml-1 h-px flex-1 copper-fade"
        />
      </div>
      {children}
    </section>
  );
}
