"use client";

import { useEffect, useState } from "react";
import {
  BookOpenText,
  Buildings,
  Drop,
  Factory,
  GearSix,
  Lightning,
  List,
  PaperPlaneTilt,
  SignOut,
  Stack,
  X,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ControlPanelLink } from "./ControlPanelLink";
import { WSPill } from "@/components/forge/WSPill";
import { RiveterButton } from "@/components/forge/RiveterButton";
import { api, ApiError } from "@/services/api";
import type { Me } from "@/services/types";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/Toaster";

export function ControlPanel() {
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
      toast.success("Workshop closed");
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
        aria-label="Open control panel"
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-30 lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-[6px] bg-forge-machine surface-rivet text-[var(--forge-text)] border border-[var(--forge-rim-dim)]"
      >
        <List weight="bold" size={20} />
      </button>

      {/* Backdrop on mobile */}
      {open ? (
        <button
          aria-label="Close control panel"
          className="fixed inset-0 z-30 bg-[var(--forge-floor-deep)]/60 backdrop-blur-[2px] lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-forge-panel px-0 py-5 transition-transform duration-200",
          "lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen",
          "before:content-[''] before:absolute before:right-0 before:top-3 before:bottom-3 before:w-1",
          "before:bg-[repeating-linear-gradient(180deg,var(--forge-rim-bright)_0_4px,transparent_4px_28px)]",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex items-center justify-between mb-5 px-4">
          <Link href="/orgs" className="flex items-center gap-2.5 group">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border border-[var(--forge-text-accent)] bg-[linear-gradient(180deg,var(--forge-rim-bright),var(--forge-rim-dim))] text-[var(--forge-floor)] surface-rivet group-hover:brightness-110 transition-[filter]">
              <Factory weight="fill" size={18} />
            </span>
            <span className="font-bold uppercase tracking-[1.2px] text-[13px] text-[var(--forge-text-accent)]">
              myccmonitor
            </span>
          </Link>
          <button
            type="button"
            aria-label="Close control panel"
            onClick={() => setOpen(false)}
            className="lg:hidden text-[var(--forge-text-muted)]"
          >
            <X weight="bold" size={20} />
          </button>
        </div>

        <div
          aria-hidden
          className="mx-4 mb-3 h-px copper-fade"
        />

        <SectionLabel>Workshop</SectionLabel>
        <nav className="space-y-px" onClick={() => setOpen(false)}>
          <ControlPanelLink
            href="/orgs"
            icon={<Buildings weight="duotone" size={16} />}
            label="Workshops"
          />
          <ControlPanelLink
            href="/groups"
            icon={<Stack weight="duotone" size={16} />}
            label="Production lines"
          />
          <ControlPanelLink
            href="/rules"
            icon={<Lightning weight="duotone" size={16} />}
            label="Blueprint library"
          />
          <ControlPanelLink
            href="/channels"
            icon={<PaperPlaneTilt weight="duotone" size={16} />}
            label="Relay tower"
          />
        </nav>

        <SectionLabel className="mt-6">Resources</SectionLabel>
        <nav className="space-y-px">
          <ControlPanelLink
            href="/docs"
            icon={<BookOpenText weight="duotone" size={16} />}
            label="Documentation"
            external
          />
        </nav>

        <SectionLabel className="mt-6">Bus</SectionLabel>
        <div className="px-4">
          <WSPill className="w-full justify-center" />
        </div>

        <div className="flex-1" />

        <div
          aria-hidden
          className="mx-4 mt-4 h-px copper-fade"
        />

        <div className="px-4 pt-3">
          {me ? (
            <div className="flex items-center gap-2.5 rounded-[4px] border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)]/70 px-2.5 py-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-[3px] border border-[var(--forge-rim-dim)] bg-[var(--forge-machine-bottom)] text-[10px] font-bold text-[var(--forge-text-accent)]">
                {(me.display_name || me.email || me.cc_user_id)
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="truncate text-[12px] text-[var(--forge-text)] font-medium">
                  {me.display_name || me.email || "Anonymous"}
                </p>
                <p className="truncate text-[10px] text-[var(--forge-text-dim)] font-mono">
                  {me.email || me.cc_user_id}
                </p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                aria-label="Leave the workshop"
                className="text-[var(--forge-text-muted)] hover:text-[var(--led-crit)]"
              >
                <SignOut weight="duotone" size={16} />
              </button>
            </div>
          ) : (
            <RiveterButton
              variant="primary"
              size="sm"
              className="w-full"
              onClick={() => router.push("/auth/login")}
            >
              <GearSix weight="fill" size={14} />
              Enter workshop
            </RiveterButton>
          )}
          <p className="mt-2 text-center text-[9px] uppercase tracking-[1.5px] text-[var(--forge-text-dim)] flex items-center justify-center gap-1.5">
            <Drop size={9} weight="fill" className="text-[var(--copper-glow)]" />
            forge mécanique
          </p>
        </div>
      </aside>
    </>
  );
}

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "px-4 pb-2 text-[9px] font-bold uppercase tracking-[1.5px] text-[var(--forge-text-dim)]",
        className,
      )}
    >
      {children}
    </p>
  );
}
