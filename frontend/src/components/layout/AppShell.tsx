import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Toaster } from "@/components/ui/Toaster";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full bg-bg text-text">
      <Sidebar />
      <main className="flex-1 min-w-0 px-6 py-10 sm:px-10 lg:px-12 lg:py-12">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
      <Toaster />
    </div>
  );
}
