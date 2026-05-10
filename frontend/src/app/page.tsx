"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowSquareOut,
  BookOpenText,
  Factory,
  GearSix,
  Lightning,
  Wrench,
} from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type { Me } from "@/services/types";
import { RiveterButton } from "@/components/forge/RiveterButton";

export default function WorkshopEntrance() {
  const [me, setMe] = useState<Me | null | "loading">("loading");

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          setMe(null);
        } else {
          console.error(err);
          setMe(null);
        }
      });
  }, []);

  return (
    <main className="relative min-h-screen flex flex-col">
      {/* Ember sparks */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden ember-spark"
      >
        <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 h-[460px] w-[680px] rounded-full bg-[radial-gradient(ellipse_at_center,var(--copper-glow)_0%,transparent_60%)] opacity-30 blur-3xl" />
        <div className="absolute -top-24 right-12 h-[260px] w-[260px] rounded-full bg-[radial-gradient(circle,var(--led-crit)_0%,transparent_60%)] opacity-15 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10 lg:px-12">
        <header className="flex items-center justify-between">
          <span className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-[4px] border border-[var(--forge-text-accent)] bg-[linear-gradient(180deg,var(--forge-rim-bright),var(--forge-rim-dim))] text-[var(--forge-floor)] surface-rivet">
              <Factory weight="fill" size={20} />
            </span>
            <span className="font-bold uppercase tracking-[1.2px] text-sm text-[var(--forge-text-accent)]">
              myccmonitor
            </span>
          </span>
          <div className="flex items-center gap-5">
            <a
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[1px] text-[var(--forge-text-muted)] hover:text-[var(--forge-text-accent)] transition-colors"
            >
              <BookOpenText weight="duotone" size={14} />
              Documentation
              <ArrowSquareOut size={10} weight="bold" />
            </a>
            <span className="hidden sm:inline-flex items-center gap-2 text-[10px] uppercase tracking-[1.5px] text-[var(--forge-text-dim)] font-mono">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--copper-glow)] shadow-[0_0_6px_var(--copper-glow)]" />
              Forge Mécanique
            </span>
          </div>
        </header>

        <section className="mt-24 flex-1 max-w-3xl">
          <p className="mb-4 inline-flex items-center gap-2 rounded-[3px] border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)] px-2.5 py-1 text-[10px] uppercase tracking-[1.5px] font-mono text-[var(--forge-text-accent)]">
            <Lightning weight="fill" size={12} />
            Multi-tenant supervision · Clever Cloud
          </p>
          <h1 className="font-serif text-5xl sm:text-6xl tracking-tight text-[var(--forge-text)] leading-[0.95]">
            Stoke the bus.{" "}
            <em className="text-[var(--copper-glow)] not-italic font-serif italic">
              Watch the floor.
            </em>{" "}
            <br className="hidden sm:block" />
            Catch the sparks before they burn.
          </h1>
          <p className="mt-6 max-w-2xl text-base text-[var(--forge-text-muted)] leading-relaxed">
            Deployment webhooks, Warp10 metrics, visual rules and multi-channel
            relays. An industrial supervision floor for your Clever Cloud
            workshops.
          </p>

          <div className="mt-10 flex items-center gap-3 flex-wrap">
            {me === "loading" ? (
              <p className="text-sm text-[var(--forge-text-dim)] font-mono">
                Spinning up the forge…
              </p>
            ) : me === null ? (
              <a href="/auth/login">
                <RiveterButton variant="primary" size="lg">
                  <GearSix weight="fill" size={16} />
                  Enter the workshop
                  <ArrowRight weight="bold" size={16} />
                </RiveterButton>
              </a>
            ) : (
              <>
                <p className="text-sm text-[var(--forge-text-muted)]">
                  Foreman:{" "}
                  <span className="font-medium text-[var(--forge-text-accent)]">
                    {me.display_name ?? me.email ?? me.cc_user_id}
                  </span>
                </p>
                <Link href="/orgs">
                  <RiveterButton variant="primary" size="lg">
                    <Wrench weight="fill" size={16} />
                    To the floor
                    <ArrowRight weight="bold" size={16} />
                  </RiveterButton>
                </Link>
              </>
            )}
          </div>

          {/* Tease of the floor */}
          <div className="mt-16 flex items-center gap-8 flex-wrap text-[11px] uppercase tracking-[1px] text-[var(--forge-text-dim)] font-mono">
            <FeatureBeacon label="Live bus" dot="var(--led-ok)" />
            <FeatureBeacon label="Visual rules" dot="var(--copper-glow)" />
            <FeatureBeacon label="Slack · email · discord" dot="var(--led-warn)" />
            <FeatureBeacon label="Multi-tenant" dot="var(--forge-text-accent)" />
          </div>
        </section>

        <footer className="mt-auto pt-12 text-[10px] uppercase tracking-[1.5px] text-[var(--forge-text-dim)] font-mono flex items-center justify-between">
          <p>Auto-deployed on Clever Cloud · forged by Frédéric</p>
          <p className="hidden sm:block">v · Forge Mécanique edition</p>
        </footer>
      </div>
    </main>
  );
}

function FeatureBeacon({ label, dot }: { label: string; dot: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: dot, boxShadow: `0 0 6px ${dot}` }}
      />
      {label}
    </span>
  );
}
