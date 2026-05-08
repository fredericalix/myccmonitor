import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border-strong bg-surface/60 px-6 py-14",
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
          {icon}
        </div>
      ) : null}
      <h3 className="font-serif text-2xl text-text mb-1.5">{title}</h3>
      {description ? (
        <p className="max-w-md text-sm text-text-muted leading-relaxed">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
