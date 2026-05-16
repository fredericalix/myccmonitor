"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle,
  Copy,
  Plugs,
  PlugsConnected,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type { McpStatus, McpTokenCreated } from "@/services/types";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog, ConfirmDialog } from "@/components/ui/Dialog";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toaster";

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export function McpPanel() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<McpTokenCreated | null>(null);
  const [showRevoke, setShowRevoke] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setStatus(await api.getMcpStatus());
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/";
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <SkeletonCard />;
  if (error)
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-critical">{error}</p>
        </CardBody>
      </Card>
    );
  if (!status) return null;

  const onToggle = async () => {
    setBusy(true);
    try {
      const next = status.enabled
        ? await api.disableMcp()
        : await api.enableMcp();
      setStatus(next);
      toast.success(
        next.enabled ? "MCP enabled" : "MCP disabled — token rejected from now on",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onGenerate = async () => {
    setBusy(true);
    try {
      const tok = await api.generateMcpToken();
      setCreated(tok);
      const next = await api.getMcpStatus();
      setStatus(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async () => {
    setBusy(true);
    try {
      await api.revokeMcpToken();
      const next = await api.getMcpStatus();
      setStatus(next);
      toast.success("Token revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setShowRevoke(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {status.enabled ? (
              <PlugsConnected
                weight="duotone"
                size={22}
                className="text-accent-strong"
              />
            ) : (
              <Plugs weight="duotone" size={22} className="text-text-muted" />
            )}
            <div>
              <h2 className="font-serif text-xl text-text leading-tight">
                MCP server
              </h2>
              <p className="text-xs text-text-muted">
                Pilot myccmonitor from AI agents (Claude Code, Claude.ai, ChatGPT)
                via the Model Context Protocol.
              </p>
            </div>
          </div>
          <Button
            variant={status.enabled ? "secondary" : "primary"}
            onClick={onToggle}
            disabled={busy}
          >
            {status.enabled ? "Disable" : "Enable"}
          </Button>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={status.enabled ? "ok" : "neutral"}>
              {status.enabled ? "active" : "off"}
            </Badge>
            <span className="text-text-muted">
              endpoint:{" "}
              <code className="font-mono text-text">{status.endpoint_url}</code>
            </span>
          </div>

          {status.has_token ? (
            <div className="rounded-md border border-border bg-surface p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-text-muted">
                    Active token
                  </div>
                  <code className="font-mono text-sm text-text">
                    {status.token_prefix}…
                  </code>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={onGenerate}
                    disabled={busy}
                  >
                    Regenerate
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowRevoke(true)}
                    disabled={busy}
                    aria-label="Revoke token"
                  >
                    <Trash weight="bold" size={16} />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-text-muted">
                <div>
                  created{" "}
                  <span className="text-text">
                    {relativeTime(status.created_at)}
                  </span>
                </div>
                <div>
                  last used{" "}
                  <span className="text-text">
                    {relativeTime(status.last_used_at)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border p-4">
              <p className="text-sm text-text-muted mb-3">
                Generate a token to connect a client. The token is shown only
                once — store it now.
              </p>
              <Button onClick={onGenerate} disabled={busy || !status.enabled}>
                Generate token
              </Button>
              {!status.enabled ? (
                <p className="mt-2 text-xs text-text-muted">
                  Enable MCP first.
                </p>
              ) : null}
            </div>
          )}

          {status.enabled && status.has_token ? (
            <ConnectionSnippets endpoint={status.endpoint_url} />
          ) : null}
        </CardBody>
      </Card>

      <Dialog
        open={created !== null}
        onClose={() => setCreated(null)}
        title="Your MCP token"
        size="lg"
        description="Copy it now — it will not be shown again."
      >
        {created ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <Warning
                weight="duotone"
                size={20}
                className="text-warning mt-0.5 shrink-0"
              />
              <div>
                Treat this like a password. Anyone with this token can pilot
                myccmonitor for your account.
              </div>
            </div>
            <div className="rounded-md border border-border bg-surface p-3">
              <code className="block break-all font-mono text-sm text-text">
                {created.token}
              </code>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                onClick={async () => {
                  await navigator.clipboard.writeText(created.token);
                  toast.success("Token copied");
                }}
              >
                <Copy weight="bold" size={16} />
                <span className="ml-2">Copy</span>
              </Button>
              <Button variant="secondary" onClick={() => setCreated(null)}>
                <CheckCircle weight="bold" size={16} />
                <span className="ml-2">I&apos;ve copied it</span>
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={showRevoke}
        onClose={() => setShowRevoke(false)}
        title="Revoke token?"
        description="Any client using this token will be rejected immediately. You can generate a new one afterwards."
        confirmLabel="Revoke"
        onConfirm={onRevoke}
        destructive
      />
    </>
  );
}

function ConnectionSnippets({ endpoint }: { endpoint: string }) {
  const cmd = `claude mcp add --transport http myccmonitor ${endpoint} --header "Authorization: Bearer mccm_…"`;
  return (
    <details className="rounded-md border border-border bg-surface p-3 text-sm">
      <summary className="cursor-pointer text-text-muted hover:text-text">
        How to connect a client
      </summary>
      <div className="mt-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted">
            Claude Code
          </div>
          <pre className="mt-1 overflow-x-auto rounded bg-bg p-2 text-xs">
            <code>{cmd}</code>
          </pre>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted">
            Claude.ai / ChatGPT custom GPT actions
          </div>
          <p className="mt-1 text-xs text-text-muted">
            URL: <code className="font-mono text-text">{endpoint}</code>
            <br />
            Header:{" "}
            <code className="font-mono text-text">
              Authorization: Bearer mccm_…
            </code>
          </p>
        </div>
      </div>
    </details>
  );
}
