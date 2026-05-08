"use client";

import { useEffect, useState } from "react";
import {
  Buildings,
  ChartLineUp,
  Lightning,
  List,
  PaperPlaneTilt,
  SignOut,
  StackSimple,
  Sun,
  X,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SidebarItem } from "./SidebarItem";
import { ThemeToggle } from "./ThemeToggle";
import { WebSocketIndicator } from "./WebSocketIndicator";
import { Button } from "@/components/ui/Button";
import { api, ApiError } from "@/services/api";
import type { Me } from "@/services/types";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/Toaster";

export function Sidebar() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          // anonymous; sidebar still renders, no user info
        }
      });
  }, []);

  const onLogout = async () => {
    try {
      await api.logout();
      toast.success("Logged out");
      router.push("/");
    } catch (err) {
      toast.error("Logout failed", { description: String(err) });
    }
  };

  return (
    <>
      {/* Mobile trigger */}
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-30 lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface border border-border shadow-warm-sm text-text-muted"
      >
        <List weight="bold" size={20} />
      </button>

      {/* Backdrop on mobile */}
      {open ? (
        <button
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-text/30 backdrop-blur-[2px] lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-surface/95 backdrop-blur border-r border-border px-4 py-6 transition-transform duration-200",
          "lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex items-center justify-between mb-6">
          <Link href="/orgs" className="flex items-center gap-2.5 group">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-on shadow-warm-sm group-hover:rotate-12 transition-transform">
              <Sun weight="duotone" size={20} />
            </span>
            <span className="font-serif text-xl tracking-tight text-text">
              myccmonitor
            </span>
          </Link>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="lg:hidden text-text-muted"
          >
            <X weight="bold" size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-1" onClick={() => setOpen(false)}>
          <SidebarItem
            href="/orgs"
            icon={<Buildings weight="duotone" size={18} />}
            label="Organisations"
          />
          <SidebarItem
            href="/groups"
            icon={<StackSimple weight="duotone" size={18} />}
            label="Groups"
          />
          <SidebarItem
            href="/rules"
            icon={<Lightning weight="duotone" size={18} />}
            label="Rules"
          />
          <SidebarItem
            href="/channels"
            icon={<PaperPlaneTilt weight="duotone" size={18} />}
            label="Channels"
          />
        </nav>

        <div className="space-y-3 pt-4 border-t border-border">
          <div className="flex items-center justify-between gap-2">
            <WebSocketIndicator />
            <ThemeToggle />
          </div>

          {me ? (
            <div className="flex items-center gap-2.5 rounded-xl bg-bg/60 px-2.5 py-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent-strong text-xs font-bold">
                {(me.display_name || me.email || me.cc_user_id)
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm text-text font-medium">
                  {me.display_name || me.email || "Anonymous"}
                </p>
                <p className="truncate text-[11px] text-text-subtle">
                  {me.email || me.cc_user_id}
                </p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                aria-label="Logout"
                className="text-text-muted hover:text-critical"
              >
                <SignOut weight="duotone" size={18} />
              </button>
            </div>
          ) : (
            <Button
              variant="primary"
              size="sm"
              className="w-full"
              onClick={() => router.push("/auth/login")}
            >
              <ChartLineUp weight="bold" size={16} />
              Sign in
            </Button>
          )}
        </div>
      </aside>
    </>
  );
}
