"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sun, ArrowRight, ChartLineUp } from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type { Me } from "@/services/types";
import { Button } from "@/components/ui/Button";

export default function Home() {
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
    <main className="relative min-h-screen flex flex-col bg-bg">
      {/* Decorative warm aura */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-24 -right-24 h-[420px] w-[420px] rounded-full bg-accent-soft blur-3xl opacity-70" />
        <div className="absolute -bottom-32 -left-24 h-[360px] w-[360px] rounded-full bg-warning-soft blur-3xl opacity-60" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10 lg:px-12">
        <header className="flex items-center justify-between">
          <span className="flex items-center gap-2.5">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-on shadow-warm-sm">
              <Sun weight="duotone" size={22} />
            </span>
            <span className="font-serif text-2xl tracking-tight text-text">
              myccmonitor
            </span>
          </span>
        </header>

        <section className="mt-20 flex-1 max-w-2xl">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong">
            <ChartLineUp weight="bold" size={14} />
            Multi-tenant supervision · Clever Cloud
          </p>
          <h1 className="font-serif text-5xl sm:text-6xl tracking-tight text-text leading-[0.95]">
            Surveille tes apps Clever Cloud,{" "}
            <em className="text-accent-strong">sans stress</em>.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-text-muted leading-relaxed">
            Webhooks de déploiement, métriques Warp10, règles visuelles et alertes
            multi-canal. Une supervision chaleureuse pour ton infra.
          </p>

          <div className="mt-10">
            {me === "loading" ? (
              <p className="text-sm text-text-subtle">Loading…</p>
            ) : me === null ? (
              <a href="/auth/login">
                <Button variant="primary" size="lg">
                  Sign in with Clever Cloud
                  <ArrowRight weight="bold" size={18} />
                </Button>
              </a>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <p className="text-sm text-text-muted">
                  Signed in as{" "}
                  <span className="font-medium text-text">
                    {me.display_name ?? me.email ?? me.cc_user_id}
                  </span>
                </p>
                <Link href="/orgs">
                  <Button variant="primary" size="lg">
                    Open dashboard
                    <ArrowRight weight="bold" size={18} />
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </section>

        <footer className="mt-auto pt-12 text-xs text-text-subtle">
          <p>Auto-deployed on Clever Cloud · made by Frédéric.</p>
        </footer>
      </div>
    </main>
  );
}
