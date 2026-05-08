"use client";

import { Toaster as SonnerToaster, toast } from "sonner";

export { toast };

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      offset={20}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "rounded-2xl border border-border bg-elevated text-text shadow-warm-md backdrop-blur",
          title: "text-text font-medium tracking-tight",
          description: "text-text-muted text-sm",
          actionButton:
            "bg-accent text-accent-on hover:bg-accent-strong rounded-md px-2.5 py-1 text-xs font-medium",
          cancelButton:
            "bg-surface text-text-muted border border-border rounded-md px-2.5 py-1 text-xs",
          success: "border-ok/30 bg-ok-soft",
          error: "border-critical/30 bg-critical-soft",
          warning: "border-warning/30 bg-warning-soft",
          info: "border-accent/30 bg-accent-soft",
        },
      }}
    />
  );
}
