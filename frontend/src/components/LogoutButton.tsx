"use client";

import { useState } from "react";
import { api } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";

export function LogoutButton({
  variant = "secondary",
}: {
  variant?: "secondary" | "ghost";
}) {
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      await api.logout();
      toast.success("Logged out");
    } catch {
      // ignore — redirect anyway
    }
    window.location.href = "/";
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={handleLogout}
      disabled={busy}
    >
      {busy ? "Logging out…" : "Logout"}
    </Button>
  );
}
