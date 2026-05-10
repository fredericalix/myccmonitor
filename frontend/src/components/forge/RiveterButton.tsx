import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "default" | "primary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[11px]",
  md: "h-9 px-3.5 text-[12px]",
  lg: "h-11 px-5 text-sm",
};

const VARIANTS: Record<Variant, string> = {
  default:
    "bg-[linear-gradient(180deg,var(--forge-rim),var(--forge-rim-dim))] text-[var(--forge-text)] border-[var(--forge-rim-bright)] hover:brightness-110",
  primary:
    "bg-[linear-gradient(180deg,var(--copper-glow),#c87830)] text-[var(--forge-floor)] border-[var(--forge-text-accent)] hover:brightness-110 font-semibold",
  danger:
    "bg-[linear-gradient(180deg,#b04444,#7c2828)] text-[var(--forge-text)] border-[#c44] hover:brightness-110",
  ghost:
    "bg-transparent text-[var(--forge-text-muted)] border-transparent hover:text-[var(--forge-text-accent)] hover:bg-[var(--forge-floor-deep)]/60",
};

export function RiveterButton({
  variant = "default",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[4px] border-[1px] uppercase tracking-[0.5px] font-semibold transition-[filter] duration-150",
        variant !== "ghost" && "surface-rivet",
        VARIANTS[variant],
        SIZES[size],
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...rest}
    />
  );
}
