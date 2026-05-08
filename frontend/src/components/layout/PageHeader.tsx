import type { ReactNode } from "react";
import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";

export interface Crumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  badge?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  badge,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-8", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav className="flex items-center gap-1 text-xs text-text-muted mb-2 flex-wrap">
          {breadcrumbs.map((crumb, idx) => (
            <span key={idx} className="inline-flex items-center gap-1">
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="hover:text-accent-strong transition-colors"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
              {idx < breadcrumbs.length - 1 ? (
                <CaretRight size={10} weight="bold" className="text-text-subtle" />
              ) : null}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-serif text-3xl sm:text-4xl tracking-tight text-text leading-none">
              {title}
            </h1>
            {badge}
          </div>
          {description ? (
            <p className="text-sm text-text-muted max-w-2xl leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
