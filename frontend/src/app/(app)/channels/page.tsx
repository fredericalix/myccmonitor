"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AddressBookTabs,
  DiscordLogo,
  EnvelopeSimple,
  Globe,
  PaperPlaneTilt,
  Plus,
  SlackLogo,
  Trash,
  X,
} from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type {
  ChannelKind,
  NotificationChannel,
  UpsertChannelInput,
} from "@/services/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { MachineCard } from "@/components/forge/MachineCard";
import { Antenna } from "@/components/forge/Antenna";
import { SignalBars } from "@/components/forge/SignalBars";
import { LedIndicator } from "@/components/forge/LedIndicator";
import { RiveterButton } from "@/components/forge/RiveterButton";
import { Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toaster";

const KIND_META: Record<
  ChannelKind,
  { label: string; icon: React.ReactNode; tagline: string }
> = {
  email: {
    label: "Email (SMTP)",
    icon: <EnvelopeSimple weight="duotone" size={20} />,
    tagline: "Sends via the configured SMTP server.",
  },
  slack: {
    label: "Slack",
    icon: <SlackLogo weight="duotone" size={20} />,
    tagline: "Posts to a Slack incoming-webhook URL.",
  },
  discord: {
    label: "Discord",
    icon: <DiscordLogo weight="duotone" size={20} />,
    tagline: "Posts to a Discord webhook URL.",
  },
  webhook: {
    label: "Generic webhook",
    icon: <Globe weight="duotone" size={20} />,
    tagline: "Posts JSON {subject, body} to any URL.",
  },
};

interface EmailConfig {
  to: string[];
  reply_to?: string;
  subject_prefix?: string;
}
interface UrlConfig {
  webhook_url: string;
}
interface GenericConfig {
  url: string;
  method: "POST" | "PUT";
  headers: { key: string; value: string }[];
}

export default function RelayTowerPage() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ChannelKind>("slack");
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [email, setEmail] = useState<EmailConfig>({ to: [] });
  const [emailDraft, setEmailDraft] = useState("");
  const [slack, setSlack] = useState<UrlConfig>({ webhook_url: "" });
  const [discord, setDiscord] = useState<UrlConfig>({ webhook_url: "" });
  const [generic, setGeneric] = useState<GenericConfig>({
    url: "",
    method: "POST",
    headers: [],
  });

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
    refresh();
  }, []);

  function resetForm() {
    setName("");
    setEmail({ to: [] });
    setEmailDraft("");
    setSlack({ webhook_url: "" });
    setDiscord({ webhook_url: "" });
    setGeneric({ url: "", method: "POST", headers: [] });
  }

  const liveConfig = useMemo<Record<string, unknown>>(() => {
    if (kind === "email") {
      const cfg: Record<string, unknown> = { to: email.to };
      if (email.reply_to) cfg.reply_to = email.reply_to;
      if (email.subject_prefix) cfg.subject_prefix = email.subject_prefix;
      return cfg;
    }
    if (kind === "slack") return { webhook_url: slack.webhook_url };
    if (kind === "discord") return { webhook_url: discord.webhook_url };
    const headers = generic.headers
      .filter((h) => h.key.trim())
      .reduce<Record<string, string>>((acc, h) => {
        acc[h.key.trim()] = h.value;
        return acc;
      }, {});
    const cfg: Record<string, unknown> = { url: generic.url, method: generic.method };
    if (Object.keys(headers).length > 0) cfg.headers = headers;
    return cfg;
  }, [kind, email, slack, discord, generic]);

  function addEmail() {
    const v = emailDraft.trim();
    if (!v) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast.error("Invalid email");
      return;
    }
    setEmail((e) => ({ ...e, to: [...e.to, v] }));
    setEmailDraft("");
  }

  function addHeader() {
    setGeneric((g) => ({ ...g, headers: [...g.headers, { key: "", value: "" }] }));
  }

  async function createChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const input: UpsertChannelInput = {
        name: name.trim(),
        kind,
        config: liveConfig,
      };
      await api.createChannel(input);
      toast.success("Transmitter wired in");
      resetForm();
      setShowForm(false);
      refresh();
    } catch (err: unknown) {
      toast.error("Wire-in failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCreating(false);
    }
  }

  async function deleteChannel(id: string) {
    try {
      await api.deleteChannel(id);
      toast.success("Transmitter removed");
      refresh();
    } catch (err: unknown) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setConfirmDeleteId(null);
    }
  }

  return (
    <>
      <PageHeader
        title={
          <span className="font-serif italic text-[var(--forge-text-accent)]">
            Relay tower
          </span>
        }
        description="Outbound transmitters for send_notification actions. Email, Slack, Discord, generic webhook."
        actions={
          <RiveterButton variant="primary" onClick={() => setShowForm((s) => !s)}>
            <Plus weight="bold" size={14} />
            New transmitter
          </RiveterButton>
        }
      />

      {showForm ? (
        <MachineCard className="p-5 mb-6">
          <form onSubmit={createChannel}>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,360px)] gap-6">
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Transmitter name"
                    value={name}
                    onChange={(ev) => setName(ev.target.value)}
                    placeholder="Slack #ops-alerts"
                    required
                  />
                  <Select
                    label="Kind"
                    value={kind}
                    onChange={(ev) => setKind(ev.target.value as ChannelKind)}
                  >
                    {(["email", "slack", "discord", "webhook"] as const).map((k) => (
                      <option key={k} value={k}>
                        {KIND_META[k].label}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="rounded-[6px] bg-[var(--forge-floor-deep)]/70 border border-[var(--forge-rim-dim)] p-4 space-y-4">
                  <p className="flex items-center gap-2 text-[11px] text-[var(--forge-text-muted)]">
                    <span className="text-[var(--copper-glow)]">{KIND_META[kind].icon}</span>
                    {KIND_META[kind].tagline}
                  </p>

                  {kind === "email" ? (
                    <>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--forge-text-dim)] mb-1.5">
                          Recipients
                        </p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {email.to.map((to) => (
                            <Chip
                              key={to}
                              variant="accent"
                              onRemove={() =>
                                setEmail((e) => ({
                                  ...e,
                                  to: e.to.filter((x) => x !== to),
                                }))
                              }
                            >
                              {to}
                            </Chip>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={emailDraft}
                            onChange={(ev) => setEmailDraft(ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") {
                                ev.preventDefault();
                                addEmail();
                              }
                            }}
                            placeholder="alerts@example.com (Enter to add)"
                            className="flex-1 rounded-[4px] border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)] px-3 py-2 text-[12px] text-[var(--forge-text)] focus:border-[var(--copper-glow)] focus:outline-none"
                          />
                          <RiveterButton type="button" onClick={addEmail}>
                            Add
                          </RiveterButton>
                        </div>
                      </div>
                      <Input
                        label="Reply-to (optional)"
                        value={email.reply_to ?? ""}
                        onChange={(ev) =>
                          setEmail((e) => ({ ...e, reply_to: ev.target.value || undefined }))
                        }
                        placeholder="ops@example.com"
                      />
                      <Input
                        label="Subject prefix (optional)"
                        value={email.subject_prefix ?? ""}
                        onChange={(ev) =>
                          setEmail((e) => ({
                            ...e,
                            subject_prefix: ev.target.value || undefined,
                          }))
                        }
                        placeholder="[myccmonitor] "
                      />
                    </>
                  ) : null}

                  {kind === "slack" ? (
                    <Input
                      label="Slack incoming webhook URL"
                      value={slack.webhook_url}
                      onChange={(ev) => setSlack({ webhook_url: ev.target.value })}
                      placeholder="https://hooks.slack.com/services/…"
                      type="url"
                      required
                    />
                  ) : null}

                  {kind === "discord" ? (
                    <Input
                      label="Discord webhook URL"
                      value={discord.webhook_url}
                      onChange={(ev) => setDiscord({ webhook_url: ev.target.value })}
                      placeholder="https://discord.com/api/webhooks/…"
                      type="url"
                      required
                    />
                  ) : null}

                  {kind === "webhook" ? (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
                        <Input
                          label="URL"
                          value={generic.url}
                          onChange={(ev) =>
                            setGeneric((g) => ({ ...g, url: ev.target.value }))
                          }
                          type="url"
                          placeholder="https://example.com/notify"
                          required
                        />
                        <Select
                          label="Method"
                          value={generic.method}
                          onChange={(ev) =>
                            setGeneric((g) => ({
                              ...g,
                              method: ev.target.value as "POST" | "PUT",
                            }))
                          }
                        >
                          <option>POST</option>
                          <option>PUT</option>
                        </Select>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--forge-text-dim)]">
                            Headers
                          </p>
                          <RiveterButton type="button" variant="ghost" size="sm" onClick={addHeader}>
                            <Plus weight="bold" size={11} />
                            Add header
                          </RiveterButton>
                        </div>
                        <div className="space-y-2">
                          {generic.headers.map((h, idx) => (
                            <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                              <Input
                                placeholder="X-Token"
                                value={h.key}
                                onChange={(ev) =>
                                  setGeneric((g) => ({
                                    ...g,
                                    headers: g.headers.map((x, i) =>
                                      i === idx ? { ...x, key: ev.target.value } : x,
                                    ),
                                  }))
                                }
                              />
                              <Input
                                placeholder="value"
                                value={h.value}
                                onChange={(ev) =>
                                  setGeneric((g) => ({
                                    ...g,
                                    headers: g.headers.map((x, i) =>
                                      i === idx ? { ...x, value: ev.target.value } : x,
                                    ),
                                  }))
                                }
                              />
                              <RiveterButton
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setGeneric((g) => ({
                                    ...g,
                                    headers: g.headers.filter((_, i) => i !== idx),
                                  }))
                                }
                              >
                                <X weight="bold" />
                              </RiveterButton>
                            </div>
                          ))}
                          {generic.headers.length === 0 ? (
                            <p className="text-[11px] text-[var(--forge-text-dim)]">
                              No headers — body still posts as JSON.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <RiveterButton
                    variant="ghost"
                    onClick={() => {
                      setShowForm(false);
                      resetForm();
                    }}
                    disabled={creating}
                  >
                    Cancel
                  </RiveterButton>
                  <RiveterButton type="submit" variant="primary" disabled={creating || !name.trim()}>
                    {creating ? "Wiring in…" : "Wire in"}
                  </RiveterButton>
                </div>
              </div>

              <aside>
                <p className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--forge-text-dim)] mb-2">
                  Live config preview
                </p>
                <pre className="rounded-[6px] bg-[var(--forge-floor-deep)] border border-[var(--forge-rim-dim)] p-3 font-mono text-[11px] text-[var(--forge-text)] leading-relaxed overflow-x-auto">
                  {JSON.stringify(liveConfig, null, 2)}
                </pre>
                <p className="mt-2 text-[10px] text-[var(--forge-text-dim)] leading-relaxed">
                  This is the JSON persisted in{" "}
                  <code className="font-mono text-[var(--forge-text-muted)]">
                    notification_channels.config
                  </code>
                  .
                </p>
              </aside>
            </div>
          </form>
        </MachineCard>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <MachineCard variant="action" className="p-4">
          <p className="text-[12px] text-[var(--forge-text)]">{error}</p>
        </MachineCard>
      ) : channels.length === 0 ? (
        <EmptyState
          icon={<PaperPlaneTilt weight="duotone" size={28} />}
          title="No transmitters wired in yet"
          description="Wire a destination to start broadcasting alerts from send_notification action nodes."
          action={
            <RiveterButton variant="primary" onClick={() => setShowForm(true)}>
              <Plus weight="bold" size={14} />
              Wire your first transmitter
            </RiveterButton>
          }
        />
      ) : (
        <ul className="space-y-3">
          {channels.map((c) => {
            const ledState = !c.enabled
              ? "unknown"
              : c.failure_count > 0 && !c.last_success_at
                ? "critical"
                : c.failure_count > 0
                  ? "warning"
                  : "ok";
            return (
              <li key={c.id}>
                <MachineCard className="p-4">
                  <div className="flex items-start gap-3">
                    <Antenna icon={KIND_META[c.kind].icon} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <LedIndicator state={ledState} size="sm" />
                        <span className="font-serif text-[16px] text-[var(--forge-text)] truncate">
                          {c.name}
                        </span>
                        <Badge variant="neutral">{c.kind}</Badge>
                        {!c.enabled ? <Badge variant="warning">disabled</Badge> : null}
                        {c.failure_count > 0 ? (
                          <Badge variant="critical">
                            {c.failure_count} failure
                            {c.failure_count === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                      </div>
                      {c.last_success_at ? (
                        <p className="mt-1 text-[11px] text-[var(--forge-text-dim)] font-mono">
                          last success {new Date(c.last_success_at).toLocaleString()}
                        </p>
                      ) : null}
                      {c.last_failure_message ? (
                        <p className="mt-1 text-[11px] text-[var(--led-crit)]">
                          last error: {c.last_failure_message}
                        </p>
                      ) : null}
                      <pre className="mt-3 overflow-x-auto rounded-[6px] bg-[var(--forge-floor-deep)] border border-[var(--forge-rim-dim)] p-3 font-mono text-[10px] text-[var(--forge-text)] leading-relaxed">
                        {JSON.stringify(c.config, null, 2)}
                      </pre>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <SignalBars
                        failureCount={c.failure_count}
                        hasRecentSuccess={!!c.last_success_at}
                        disabled={!c.enabled}
                      />
                      <RiveterButton
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteId(c.id)}
                        aria-label="Remove transmitter"
                      >
                        <Trash weight="bold" size={12} />
                      </RiveterButton>
                    </div>
                  </div>
                </MachineCard>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-8 text-[10px] uppercase tracking-[1px] text-[var(--forge-text-dim)] inline-flex items-center gap-1.5 font-mono">
        <AddressBookTabs size={11} weight="bold" />
        Transmitter IDs are referenced by{" "}
        <code className="font-mono mx-1 text-[var(--forge-text-muted)]">
          send_notification
        </code>{" "}
        action nodes in the rule editor.
      </p>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) {
            return deleteChannel(confirmDeleteId);
          }
        }}
        title="Remove this transmitter?"
        description="Rules referencing it will fail to broadcast until you point them elsewhere."
        confirmLabel="Remove"
        destructive
      />
    </>
  );
}
