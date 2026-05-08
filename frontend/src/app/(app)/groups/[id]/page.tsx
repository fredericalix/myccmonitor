"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plus, Trash } from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type { GroupView, Monitor, Org } from "@/services/types";
import { StateBadge } from "@/components/StateBadge";
import { RolledStateBadge } from "@/components/RolledStateBadge";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toaster";

export default function GroupDetailPage() {
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
      toast.success("Member added");
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
      toast.success("Member removed");
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
      toast.success("Group deleted");
      router.push("/groups");
    } catch (err: unknown) {
      toast.error("Failed to delete", {
        description: err instanceof Error ? err.message : String(err),
      });
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (loading)
    return <p className="text-sm text-text-muted">Loading…</p>;
  if (error)
    return (
      <Card className="p-5 border-critical/30 bg-critical-soft">
        <p className="text-sm text-critical">{error}</p>
      </Card>
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
        title={group.name}
        description={group.description ?? "Manage members and inspect auto-grouping rules."}
        breadcrumbs={[
          { label: "Groups", href: "/groups" },
          { label: group.name },
        ]}
        badge={<RolledStateBadge state={group.rolled_state} />}
        actions={
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
          >
            <Trash weight="bold" size={14} />
            Delete
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 space-y-6">
          <Card className="p-5">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              Members ({memberMonitors.length} of {group.state_breakdown.total} effective)
            </h2>
            {memberMonitors.length === 0 ? (
              <p className="text-sm text-text-subtle">
                No members yet. Add monitors below or set up auto-grouping rules.
              </p>
            ) : (
              <ul className="space-y-2">
                {memberMonitors.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded-xl bg-bg/60 border border-border px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text truncate">
                          {m.display_name}
                        </span>
                        <StateBadge state={m.current_state} />
                      </div>
                      <p className="font-mono text-[11px] text-text-subtle truncate">
                        {m.kind} · {m.cc_resource_id ?? "synthetic"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMember(m.id)}
                      disabled={busy}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              Add a monitor
            </h2>
            <div className="flex items-end gap-2">
              <Select
                containerClassName="flex-1"
                label="Pick a monitor"
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
              <Button
                variant="primary"
                onClick={addMember}
                disabled={!pickerSelected || busy}
              >
                <Plus weight="bold" size={16} />
                Add
              </Button>
            </div>
          </Card>
        </section>

        <aside className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              Auto-grouping
            </h2>
            <pre className="overflow-x-auto rounded-md bg-bg/60 border border-border p-3 font-mono text-[11px] text-text leading-relaxed">
              {JSON.stringify(group.auto_rules ?? {}, null, 2)}
            </pre>
            <p className="mt-3 text-[11px] text-text-subtle leading-relaxed">
              Edit the JSON via the API today; a structured editor lands in a
              follow-up phase.
            </p>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteGroup}
        title="Delete this group?"
        description="Members are not affected, but rules referencing this group will need an update."
        confirmLabel="Delete group"
        destructive
        loading={busy}
      />
    </>
  );
}
