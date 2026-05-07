// Mirror of the JSON shapes the backend returns.

export interface Me {
  user_id: string;
  cc_user_id: string;
  email: string | null;
  display_name: string | null;
}

export interface Org {
  id: string;
  user_id: string;
  cc_org_id: string;
  name: string | null;
  avatar_url: string | null;
  refreshed_at: string;
}

export type MonitorState = "ok" | "warning" | "critical" | "unknown";

export interface Monitor {
  id: string;
  user_id: string;
  cc_org_id: string | null;
  kind: "cc_application" | "cc_addon" | "synthetic";
  cc_resource_id: string | null;
  display_name: string;
  enabled: boolean;
  poll_interval_seconds: number;
  current_state: MonitorState;
  current_message: string | null;
  current_state_since: string | null;
  last_poll_at: string | null;
  acknowledged: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookConfig {
  id: string;
  user_id: string;
  cc_org_id: string;
  cc_webhook_id: string | null;
  subscribed_events: string[];
  last_received_at: string | null;
  failure_count: number;
  created_at: string;
}

export type WsFrame =
  | {
      type: "monitor_state";
      monitor_id: string;
      state: MonitorState;
      message: string | null;
      since: string | null;
    }
  | {
      type: "webhook_health";
      cc_org_id: string;
      last_received_at: string;
    }
  | {
      type: "metrics_snapshot";
      monitor_id: string;
      ts: string;
      cpu: number | null;
      mem: number | null;
    };

export interface MetricSnapshot {
  cpu: number | null;
  mem: number | null;
  ts: string;
}

export interface AutoRules {
  name_pattern?: string;
  kinds?: string[];
}

export type GroupRolledState =
  | "ok"
  | "warning"
  | "critical"
  | "unknown";

export interface StateBreakdown {
  ok: number;
  warning: number;
  critical: number;
  unknown: number;
  total: number;
}

export interface GroupView {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  auto_rules: AutoRules | null;
  created_at: string;
  updated_at: string;
  member_ids: string[];
  rolled_state: GroupRolledState;
  state_breakdown: StateBreakdown;
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  auto_rules?: AutoRules;
}
