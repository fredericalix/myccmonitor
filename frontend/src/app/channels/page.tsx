"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/services/api";
import type {
  ChannelKind,
  NotificationChannel,
  UpsertChannelInput,
} from "@/services/types";

const KINDS: { value: ChannelKind; label: string; configHint: string }[] = [
  {
    value: "email",
    label: "Email (SMTP)",
    configHint: '{ "to": ["alerts@example.com"], "subject_prefix": "[myccmonitor] " }',
  },
  {
    value: "slack",
    label: "Slack",
    configHint: '{ "webhook_url": "https://hooks.slack.com/services/..." }',
  },
  {
    value: "discord",
    label: "Discord",
    configHint:
      '{ "webhook_url": "https://discord.com/api/webhooks/..." }',
  },
  {
    value: "webhook",
    label: "Generic webhook",
    configHint:
      '{ "url": "https://example.com/notify", "method": "POST", "headers": { "X-Token": "..." } }',
  },
];

export default function ChannelsPage() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline create form
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ChannelKind>("slack");
  const [configText, setConfigText] = useState(KINDS[1].configHint);
  const [creating, setCreating] = useState(false);

  function refresh() {
    api
      .listChannels()
      .then(setChannels)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let active = true;
    api
      .listChannels()
      .then((cs) => {
        if (active) setChannels(cs);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function handleKindChange(k: ChannelKind) {
    setKind(k);
    const hint = KINDS.find((x) => x.value === k)?.configHint ?? "{}";
    setConfigText(hint);
  }

  async function createChannel(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(configText);
      } catch {
        alert("Config is not valid JSON.");
        return;
      }
      const input: UpsertChannelInput = {
        name: name.trim(),
        kind,
        config,
      };
      await api.createChannel(input);
      setName("");
      handleKindChange(kind);
      refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function deleteChannel(id: string) {
    if (!confirm("Delete this channel? Rules referencing it will fail to send.")) return;
    try {
      await api.deleteChannel(id);
      refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Notification channels
        </h1>
        <Link href="/orgs" className="text-sm text-slate-500 hover:text-slate-900">
          ← Organisations
        </Link>
      </div>

      <form
        onSubmit={createChannel}
        className="mb-10 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          New channel
        </h2>
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Channel name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <select
            value={kind}
            onChange={(e) => handleKindChange(e.target.value as ChannelKind)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          rows={4}
          className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
        />
        <p className="mb-3 text-[11px] text-slate-500">
          JSON config — shape depends on kind. See the placeholder above for the
          expected fields.
        </p>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create channel"}
        </button>
      </form>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {!loading && channels.length === 0 && !error && (
        <p className="text-sm text-slate-500">
          No channels yet. Add one above to start receiving alerts from
          <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 font-mono">
            send_notification
          </code>
          actions.
        </p>
      )}

      <ul className="space-y-3">
        {channels.map((c) => (
          <li
            key={c.id}
            className="flex items-start justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">{c.name}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-mono uppercase text-slate-600">
                  {c.kind}
                </span>
                {!c.enabled && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                    disabled
                  </span>
                )}
                {c.failure_count > 0 && (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-mono text-rose-700">
                    {c.failure_count} failure{c.failure_count === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {c.last_success_at && (
                <p className="mt-0.5 text-xs text-slate-500">
                  last success {new Date(c.last_success_at).toLocaleString()}
                </p>
              )}
              {c.last_failure_message && (
                <p className="mt-0.5 text-xs text-rose-600">
                  last error: {c.last_failure_message}
                </p>
              )}
              <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
{JSON.stringify(c.config, null, 2)}
              </pre>
            </div>
            <button
              onClick={() => deleteChannel(c.id)}
              className="ml-3 rounded-md border border-rose-300 px-3 py-1 text-xs text-rose-700 hover:bg-rose-50"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-xs text-slate-400">
        Channel IDs are referenced by{" "}
        <code className="font-mono">send_notification</code> action nodes in the
        rule editor.
      </p>
    </main>
  );
}
