"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plus, Trash } from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type { GroupView, Monitor, Org } from "@/services/types";
import { LedIndicator } from "@/components/forge/LedIndicator";
import { MachineCard, MachineLabel } from "@/components/forge/MachineCard";
import { RiveterButton } from "@/components/forge/RiveterButton";
import { RolledStateReactor } from "@/components/forge/RolledStateReactor";
import { Conveyor } from "@/components/forge/Conveyor";
import { PageHeader } from "@/components/layout/PageHeader";
import { Select } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toaster";

export default function ProductionLinePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [group, setGroup] = useState<GroupView | null>(null);
  const [allMonitors, setAllMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = useCallback(async () => {
    try {
      const g = await api.getGroup(id);
      setGroup(g);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/auth/login";
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const orgs: Org[] = await api.listOrgs();
        const monitorLists = await Promise.all(
          orgs.map((o) => api.listMonitors(o.cc_org_id).catch(() => [])),
        );
        if (!active) return;
        setAllMonitors(monitorLists.flat());
        await reload();
      } catch (err: unknown) {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reload]);

  async function addMember() {
    if (!pickerSelected) return;
    setBusy(true);
    try {
      await api.addGroupMember(id, pickerSelected);
      setPickerSelected("");
      await reload();
      toast.success("Machine joined the line");
    } catch (err: unknown) {
      toast.error("Failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(monitorId: string) {
    setBusy(true);
    try {
      await api.removeGroupMember(id, monitorId);
      await reload();
      toast.success("Machine pulled from the line");
    } catch (err: unknown) {
      toast.error("Failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup() {
    setBusy(true);
    try {
      await api.deleteGroup(id);
      toast.success("Production line dismantled");
      router.push("/groups");
    } catch (err: unknown) {
      toast.error("Failed to dismantle", {
        description: err instanceof Error ? err.message : String(err),
      });
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (loading)
    return (
      <p className="text-[12px] text-[var(--forge-text-muted)] font-mono">
        Spinning up the line…
      </p>
    );
  if (error)
    return (
      <MachineCard variant="action" className="p-4">
        <p className="text-[12px] text-[var(--forge-text)]">{error}</p>
      </MachineCard>
    );
  if (!group) return null;

  const memberMonitors = allMonitors.filter((m) =>
    group.member_ids.includes(m.id),
  );
  const memberSet = new Set(group.member_ids);
  const candidates = allMonitors.filter((m) => !memberSet.has(m.id));

  return (
    <>
      <PageHeader
        title={
          <span>
            <span className="text-[var(--forge-text)]">{group.name}</span>{" "}
            <span className="text-[var(--forge-text-dim)]">·</span>{" "}
            <span className="font-serif italic text-[var(--forge-text-accent)]">
              Production line
            </span>
          </span>
        }
        description={
          group.description ?? "Manage members and inspect auto-grouping rules."
        }
        breadcrumbs={[
          { label: "Production lines", href: "/groups" },
          { label: group.name },
        ]}
        actions={
          <RiveterButton
            variant="danger"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
          >
            <Trash weight="bold" size={12} />
            Dismantle
          </RiveterButton>
        }
      />

      {/* Reactor + assembly belt visualization */}
      <MachineCard className="p-6 mb-6 bg-forge-blueprint">
        <div className="flex flex-col items-center gap-5">
          <RolledStateReactor state={group.rolled_state} size="lg" />
          {memberMonitors.length > 0 ? (
            <div className="flex items-center justify-center flex-wrap gap-0">
              <Conveyor width={20} active={group.rolled_state !== "unknown"} />
              {memberMonitors.slice(0, 8).map((m, idx, arr) => (
                <div key={m.id} className="flex items-center">
                  <div className="flex flex-col items-center gap-1.5 min-w-[68px] px-1">
                    <LedIndicator state={m.current_state} size="md" />
                    <span className="font-mono text-[9px] uppercase tracking-[0.5px] text-[var(--forge-text)] text-center max-w-[80px] truncate">
                      {m.display_name}
                    </span>
                  </div>
                  <Conveyor
                    width={idx === arr.length - 1 ? 20 : 24}
                    active={group.rolled_state !== "unknown"}
                  />
                </div>
              ))}
              {memberMonitors.length > 8 ? (
                <span className="font-mono text-[10px] text-[var(--forge-text-muted)] ml-2">
                  +{memberMonitors.length - 8} more
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-[11px] text-[var(--forge-text-dim)] font-mono">
              No machines on the line yet.
            </p>
          )}
          <div className="flex items-center gap-3 flex-wrap font-mono text-[11px]">
            <Stat label="OK" count={group.state_breakdown.ok} dot="var(--led-ok)" />
            <Stat
              label="WARN"
              count={group.state_breakdown.warning}
              dot="var(--led-warn)"
            />
            <Stat
              label="CRIT"
              count={group.state_breakdown.critical}
              dot="var(--led-crit)"
            />
            <Stat
              label="UNKNOWN"
              count={group.state_breakdown.unknown}
              dot="var(--led-dim)"
            />
            <span className="text-[var(--forge-text-dim)]">
              · {group.state_breakdown.total} total
            </span>
          </div>
        </div>
      </MachineCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 space-y-6">
          <MachineCard className="p-5">
            <MachineLabel>
              <span className="normal-case tracking-normal">
                <span className="font-serif text-[15px] text-[var(--forge-text)]">
                  Members
                </span>
                <span className="ml-2 text-[10px] uppercase tracking-[1px] text-[var(--forge-text-dim)] font-mono">
                  ({memberMonitors.length} of {group.state_breakdown.total} effective)
                </span>
              </span>
            </MachineLabel>
            {memberMonitors.length === 0 ? (
              <p className="text-[12px] text-[var(--forge-text-dim)]">
                No members yet. Add machines below or set up auto-grouping rules.
              </p>
            ) : (
              <ul className="space-y-2">
                {memberMonitors.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded-[4px] bg-[var(--forge-floor-deep)]/70 border border-[var(--forge-rim-dim)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <LedIndicator state={m.current_state} size="sm" />
                        <span className="font-medium text-[var(--forge-text)] truncate">
                          {m.display_name}
                        </span>
                      </div>
                      <p className="font-mono text-[10px] text-[var(--forge-text-dim)] truncate mt-0.5">
                        {m.kind} · {m.cc_resource_id ?? "synthetic"}
                      </p>
                    </div>
                    <RiveterButton
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMember(m.id)}
                      disabled={busy}
                    >
                      Remove
                    </RiveterButton>
                  </li>
                ))}
              </ul>
            )}
          </MachineCard>

          <MachineCard className="p-5">
            <MachineLabel>
              <span className="normal-case tracking-normal font-serif text-[15px] text-[var(--forge-text)]">
                Add a machine
              </span>
            </MachineLabel>
            <div className="flex items-end gap-2">
              <Select
                containerClassName="flex-1"
                label="Pick a machine"
                value={pickerSelected}
                onChange={(e) => setPickerSelected(e.target.value)}
              >
                <option value="">— pick —</option>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name} ({m.kind})
                  </option>
                ))}
              </Select>
              <RiveterButton
                variant="primary"
                onClick={addMember}
                disabled={!pickerSelected || busy}
              >
                <Plus weight="bold" size={14} />
                Add
              </RiveterButton>
            </div>
          </MachineCard>
        </section>

        <aside className="space-y-6">
          <MachineCard className="p-5">
            <MachineLabel>
              <span className="normal-case tracking-normal font-serif text-[15px] text-[var(--forge-text)]">
                Auto-grouping rules
              </span>
            </MachineLabel>
            <pre className="overflow-x-auto rounded-[4px] bg-[var(--forge-floor-deep)] border border-[var(--forge-rim-dim)] p-3 font-mono text-[10px] text-[var(--forge-text)] leading-relaxed">
              {JSON.stringify(group.auto_rules ?? {}, null, 2)}
            </pre>
            <p className="mt-3 text-[10px] text-[var(--forge-text-dim)] leading-relaxed">
              Edit the JSON via the API today; a structured editor lands in a
              follow-up phase.
            </p>
          </MachineCard>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteGroup}
        title="Dismantle this line?"
        description="Members are not affected, but rules referencing this line will need updating."
        confirmLabel="Dismantle"
        destructive
        loading={busy}
      />
    </>
  );
}

function Stat({
  label,
  count,
  dot,
}: {
  label: string;
  count: number;
  dot: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${count === 0 ? "opacity-50" : ""}`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{
          background: dot,
          boxShadow: count > 0 ? `0 0 6px ${dot}` : "none",
        }}
      />
      <span className="uppercase tracking-[0.5px] text-[var(--forge-text-muted)]">
        {label}
      </span>
      <span className="tabular-nums text-[var(--forge-text)]">{count}</span>
    </span>
  );
}
