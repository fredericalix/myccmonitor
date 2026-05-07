import type {
  CreateGroupInput,
  GroupView,
  Me,
  Monitor,
  Org,
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
};
