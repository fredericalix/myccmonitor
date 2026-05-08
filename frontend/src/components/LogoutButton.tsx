"use client";

import { api } from "@/services/api";
import { useState } from "react";

export function LogoutButton({
  variant = "outline",
}: {
  variant?: "outline" | "link";
}) {
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      await api.logout();
    } catch {
      // ignore — we redirect to / either way; the home page detects
      // the missing session via /api/me and shows the sign-in CTA.
    }
    window.location.href = "/";
  }

  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={handleLogout}
        disabled={busy}
        className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50"
      >
        {busy ? "Logging out…" : "Logout"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={busy}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
    >
      {busy ? "Logging out…" : "Logout"}
    </button>
  );
}
