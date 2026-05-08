"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, StackSimple } from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type { GroupView } from "@/services/types";
import { RolledStateBadge } from "@/components/RolledStateBadge";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toaster";

const KINDS = ["cc_application", "cc_addon", "synthetic"] as const;

export default function GroupsPage() {
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
      toast.success("Group created");
      refresh();
    } catch (err: unknown) {
      toast.error("Failed to create group", {
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
        title="Monitor groups"
        description="Group monitors with auto-matching rules (regex on name, monitor kind) and reference them from workflow rules with group:{id}:state."
        actions={
          <Button
            variant="primary"
            onClick={() => setShowForm((s) => !s)}
            size="md"
          >
            <Plus weight="bold" size={16} />
            New group
          </Button>
        }
      />

      {showForm ? (
        <Card variant="elevated" className="p-5 mb-6">
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
                hint="Monitors whose display name matches this regex are auto-included."
              />
            </div>
            <div>
              <p className="text-xs font-medium text-text-muted mb-2 tracking-wide">
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
                          ? "rounded-full bg-accent text-accent-on px-3 py-1 text-xs font-medium"
                          : "rounded-full bg-surface text-text-muted border border-border px-3 py-1 text-xs font-medium hover:bg-accent-soft"
                      }
                    >
                      {k}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => setShowForm(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={creating || !newName.trim()}
              >
                {creating ? "Creating…" : "Create group"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <Card className="p-5 border-critical/30 bg-critical-soft">
          <p className="text-sm text-critical">{error}</p>
        </Card>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<StackSimple weight="duotone" size={28} />}
          title="No groups yet"
          description="Groups let you treat fleets of monitors as one. Use them in rule conditions like group:{id}:critical_count > 2."
          action={
            <Button variant="primary" onClick={() => setShowForm(true)}>
              <Plus weight="bold" size={16} />
              Create your first group
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Card variant="interactive" className="p-5 h-full flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-serif text-xl text-text">
                      {g.name}
                    </p>
                    {g.description ? (
                      <p className="mt-1 text-xs text-text-muted line-clamp-2">
                        {g.description}
                      </p>
                    ) : null}
                  </div>
                  <RolledStateBadge state={g.rolled_state} />
                </div>
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
                    <Button variant="ghost" size="sm">
                      Manage
                      <ArrowRight weight="bold" size={14} />
                    </Button>
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
