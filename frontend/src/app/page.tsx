"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/services/api";
import type { Me } from "@/services/types";

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
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900">
        myccmonitor
      </h1>
      <p className="mt-3 text-lg text-slate-600">
        Multi-tenant supervision for your Clever Cloud applications and addons.
      </p>

      <div className="mt-10">
        {me === "loading" && (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
        {me === null && (
          <a
            href="/auth/login"
            className="inline-flex items-center rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
          >
            Sign in with Clever Cloud
          </a>
        )}
        {me && me !== "loading" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Signed in as{" "}
              <span className="font-medium">
                {me.display_name ?? me.email ?? me.cc_user_id}
              </span>
              .
            </p>
            <Link
              href="/orgs"
              className="inline-flex items-center rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
            >
              View your organisations →
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
