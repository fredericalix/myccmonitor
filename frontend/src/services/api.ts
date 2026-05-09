import type {
  CreateGroupInput,
  DryRunResult,
  GroupView,
  Me,
  MetricSnapshotApi,
  Monitor,
  MonitorDebugResponse,
  NotificationChannel,
  Org,
  Rule,
  RuleDebugResponse,
  RuleFiring,
  UpsertChannelInput,
  UpsertRuleInput,
  WebhookConfig,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const msg =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<Me>("/api/me"),
  listOrgs: () => request<Org[]>("/api/orgs"),
  setupWebhook: (ccOrgId: string) =>
    request<WebhookConfig>(
      `/api/orgs/${encodeURIComponent(ccOrgId)}/webhook`,
      { method: "POST", body: "{}" },
    ),
  listMonitors: (ccOrgId: string) =>
    request<Monitor[]>(`/api/orgs/${encodeURIComponent(ccOrgId)}/monitors`),
  listSnapshots: (ccOrgId: string) =>
    request<MetricSnapshotApi[]>(
      `/api/orgs/${encodeURIComponent(ccOrgId)}/snapshots`,
    ),
  monitorDebug: (ccOrgId: string, monitorId: string) =>
    request<MonitorDebugResponse>(
      `/api/orgs/${encodeURIComponent(ccOrgId)}/monitors/${encodeURIComponent(monitorId)}/debug`,
    ),
  logout: () => request<void>("/auth/logout", { method: "POST", body: "{}" }),

  listGroups: () => request<GroupView[]>("/api/groups"),
  createGroup: (input: CreateGroupInput) =>
    request<GroupView>("/api/groups", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getGroup: (id: string) => request<GroupView>(`/api/groups/${id}`),
  deleteGroup: (id: string) =>
    request<void>(`/api/groups/${id}`, { method: "DELETE" }),
  addGroupMember: (groupId: string, monitorId: string) =>
    request<void>(`/api/groups/${groupId}/members/${monitorId}`, {
      method: "POST",
      body: "{}",
    }),
  removeGroupMember: (groupId: string, monitorId: string) =>
    request<void>(`/api/groups/${groupId}/members/${monitorId}`, {
      method: "DELETE",
    }),

  listRules: () => request<Rule[]>("/api/rules"),
  createRule: (input: UpsertRuleInput) =>
    request<Rule>("/api/rules", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getRule: (id: string) => request<Rule>(`/api/rules/${id}`),
  updateRule: (id: string, input: UpsertRuleInput) =>
    request<Rule>(`/api/rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteRule: (id: string) =>
    request<void>(`/api/rules/${id}`, { method: "DELETE" }),
  ruleFirings: (id: string) =>
    request<RuleFiring[]>(`/api/rules/${id}/firings`),
  testRule: (id: string) =>
    request<DryRunResult>(`/api/rules/${id}/test`, {
      method: "POST",
      body: "{}",
    }),
  debugRule: (id: string) =>
    request<RuleDebugResponse>(`/api/rules/${id}/debug`),

  listChannels: () => request<NotificationChannel[]>("/api/channels"),
  createChannel: (input: UpsertChannelInput) =>
    request<NotificationChannel>("/api/channels", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateChannel: (id: string, input: UpsertChannelInput) =>
    request<NotificationChannel>(`/api/channels/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteChannel: (id: string) =>
    request<void>(`/api/channels/${id}`, { method: "DELETE" }),
};
