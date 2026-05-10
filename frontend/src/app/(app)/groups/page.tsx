"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, Stack } from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type { GroupView } from "@/services/types";
import { LedIndicator } from "@/components/forge/LedIndicator";
import { MachineCard, MachineLabel } from "@/components/forge/MachineCard";
import { RiveterButton } from "@/components/forge/RiveterButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toaster";

const KINDS = ["cc_application", "cc_addon", "synthetic"] as const;

export default function ProductionLinesPage() {
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newKinds, setNewKinds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  function refresh() {
    api
      .listGroups()
      .then(setGroups)
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

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const auto_rules =
        newPattern.trim() || newKinds.length > 0
          ? {
              name_pattern: newPattern.trim() || undefined,
              kinds: newKinds.length > 0 ? newKinds : undefined,
            }
          : undefined;
      await api.createGroup({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        auto_rules,
      });
      setNewName("");
      setNewDescription("");
      setNewPattern("");
      setNewKinds([]);
      setShowForm(false);
      toast.success("Production line opened");
      refresh();
    } catch (err: unknown) {
      toast.error("Could not open the line", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCreating(false);
    }
  }

  function toggleKind(k: string) {
    setNewKinds((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  }

  return (
    <>
      <PageHeader
        title={
          <span className="font-serif italic text-[var(--forge-text-accent)]">
            Production lines
          </span>
        }
        description="Group machines with auto-matching rules (regex on name, monitor kind) and address them in workflow rules with group:{id}:state."
        actions={
          <RiveterButton variant="primary" onClick={() => setShowForm((s) => !s)}>
            <Plus weight="bold" size={14} />
            New line
          </RiveterButton>
        }
      />

      {showForm ? (
        <MachineCard className="p-5 mb-6">
          <form onSubmit={createGroup} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="prod-eu-fleet"
                required
              />
              <Input
                label="Description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="(optional)"
              />
              <Input
                containerClassName="sm:col-span-2"
                label="Auto-match name regex"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                placeholder="^prod-"
                hint="Machines whose display name matches this regex are auto-included."
              />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--forge-text-dim)] mb-2">
                Auto-match kinds
              </p>
              <div className="flex flex-wrap gap-2">
                {KINDS.map((k) => {
                  const on = newKinds.includes(k);
                  return (
                    <button
                      type="button"
                      key={k}
                      onClick={() => toggleKind(k)}
                      className={
                        on
                          ? "rounded-[3px] bg-[linear-gradient(180deg,var(--copper-glow),#c87830)] text-[var(--forge-floor)] border border-[var(--forge-text-accent)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.5px]"
                          : "rounded-[3px] bg-[var(--forge-floor-deep)] text-[var(--forge-text-muted)] border border-[var(--forge-rim-dim)] px-3 py-1 text-[11px] uppercase tracking-[0.5px] hover:text-[var(--forge-text-accent)] hover:border-[var(--forge-rim-bright)]"
                      }
                    >
                      {k}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <RiveterButton
                variant="ghost"
                onClick={() => setShowForm(false)}
                disabled={creating}
              >
                Cancel
              </RiveterButton>
              <RiveterButton
                type="submit"
                variant="primary"
                disabled={creating || !newName.trim()}
              >
                {creating ? "Opening…" : "Open line"}
              </RiveterButton>
            </div>
          </form>
        </MachineCard>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <MachineCard variant="action" className="p-4">
          <p className="text-[12px] text-[var(--forge-text)]">{error}</p>
        </MachineCard>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Stack weight="duotone" size={28} />}
          title="No production lines yet"
          description="Lines let you treat fleets of machines as one. Use them in rule conditions like group:{id}:critical_count > 2."
          action={
            <RiveterButton variant="primary" onClick={() => setShowForm(true)}>
              <Plus weight="bold" size={14} />
              Open the first line
            </RiveterButton>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id}>
              <MachineCard
                variant={g.rolled_state === "critical" ? "action" : "default"}
                className="p-4 h-full flex flex-col gap-3 hover:-translate-y-0.5 hover:brightness-110 transition-[transform,filter] duration-150"
              >
                <MachineLabel>
                  <span className="flex items-center gap-2 normal-case tracking-normal">
                    <LedIndicator state={g.rolled_state} size="md" />
                    <span className="font-serif text-[18px] leading-tight text-[var(--forge-text)] truncate">
                      {g.name}
                    </span>
                  </span>
                  <span className="rounded-[3px] border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)]/70 px-1.5 py-0.5 text-[9px] tracking-[0.5px] text-[var(--forge-text-muted)] font-mono">
                    LINE
                  </span>
                </MachineLabel>
                {g.description ? (
                  <p className="-mt-1 text-[11px] text-[var(--forge-text-muted)] line-clamp-2">
                    {g.description}
                  </p>
                ) : null}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Chip>
                    {g.state_breakdown.total} member
                    {g.state_breakdown.total === 1 ? "" : "s"}
                  </Chip>
                  {g.state_breakdown.critical > 0 ? (
                    <Chip variant="accent">
                      {g.state_breakdown.critical} critical
                    </Chip>
                  ) : null}
                  {g.state_breakdown.warning > 0 ? (
                    <Chip variant="accent">
                      {g.state_breakdown.warning} warning
                    </Chip>
                  ) : null}
                </div>
                <div className="mt-auto pt-1 flex justify-end">
                  <Link href={`/groups/${g.id}`}>
                    <RiveterButton variant="ghost" size="sm">
                      Inspect
                      <ArrowRight weight="bold" size={12} />
                    </RiveterButton>
                  </Link>
                </div>
              </MachineCard>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
