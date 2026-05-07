# myccmonitor

> Multi-tenant supervision tool for Clever Cloud applications. Login OAuth CC, ingest deployment webhooks via Pulsar, poll Warp10 metrics, evaluate a full **workflow engine** (nested AND/OR conditions, cross-resource rules, chained `setMonitorState` actions, time-based `for Xm`, group-aware), edit rules in a **ReactFlow visual editor**, fan out alerts (with handlebars templating) to email/Slack/Discord/webhook, push live frames to dashboards over WebSocket.

This file is the spec. Read it before touching anything. Update it when behavior changes.

---

## 1. Mission

myccmonitor watches the Clever Cloud apps and addons of every signed-in user, and tells them when something is wrong (deploy failed, CPU pegged, addon down, complex composite condition met) through the channel of their choice. It is itself deployed on Clever Cloud (dogfood). One Clever Cloud account = one tenant; data and tokens are strictly isolated per user. The workflow engine is a faxmon-parity rule system, lifted and adapted to the CC domain, with four critical fixes over faxmon: per-rule cool-down, first-class time-based conditions, synthetic monitors for clean chaining, and group-aware rules.

## 2. Quick start

```bash
git clone <this repo> && cd myccmonitor
cp .env.example .env

# One-time host prerequisite: `protoc` is required to build the `pulsar` crate.
brew install protobuf                             # macOS; on Linux use your package manager

# Generate the at-rest token encryption key
openssl rand -hex 32                              # paste into APP_ENCRYPTION_KEY in .env

# Create a Clever Cloud OAuth consumer for myccmonitor (one per environment).
# The public clever-tools key does NOT accept arbitrary callback URLs.
clever oauth-consumers create myccmonitor-dev \
    --description "myccmonitor (dev)" \
    --url        "http://localhost:3000" \
    --base-url   "http://localhost:3000" \
    --rights all
clever oauth-consumers get <key-from-create> --with-secret
# Paste the key + secret into CC_CONSUMER_KEY / CC_CONSUMER_SECRET in .env.

docker compose -f docker-compose.dev.yml up -d postgres   # Phase 1: Postgres only
# (add `pulsar` from Phase 2 onwards: `docker compose ... up -d`)

cd backend && cargo run                           # runs sqlx migrations on boot, listens :8080

cd frontend && npm run dev                        # http://localhost:3000
```

OAuth callback in dev: `PUBLIC_BASE_URL=http://localhost:3000`. The Next.js dev server rewrites `/auth/*`, `/api/*`, `/ws`, `/webhooks/*` to `BACKEND_INTERNAL_URL` (defaults to `http://localhost:8080`).

## 3. Stack

**Backend** — Rust 1.85+ (edition 2024), Axum 0.8, Tokio, sqlx 0.8 (Postgres), tower-sessions 0.14 + tower-sessions-sqlx-store, aes-gcm 0.10 (AES-256-GCM for OAuth tokens at rest), reqwest 0.12, lettre 0.11 (SMTP), `pulsar` 6.x crate (`pulsar-rs`, requires `protoc` at build time), `petgraph` 0.6 (cycle detection in rule DAG), `handlebars` 6 (notification templating), tracing.

**Frontend** — Next.js **16** (app router; this is a major upgrade from 15 with breaking changes — see `frontend/AGENTS.md` and `frontend/node_modules/next/dist/docs/` before writing Next-specific code), TypeScript 5, React 19.2, Zustand 5, **Tailwind CSS v4** (CSS-only config, no `tailwind.config.js`), shadcn/ui, ECharts, **ReactFlow 11 + Dagre** (visual rule editor), native WebSocket with auto-reconnect.

**Infra** — Postgres (data + sessions + LISTEN/NOTIFY + advisory locks), Apache Pulsar (durable webhook inbox + 30-day audit/replay + delayed messages for rule escalations), Clever Cloud as deploy target.

**Why these choices**
- Rust/Axum + Postgres + AES-GCM tokens: matches existing CC projects under `apple/` (myccmetrics, mycctown), proven OAuth code to lift.
- Pulsar (webhook inbox + escalations): zero event loss across restarts; retention serves as audit log; native delayed-delivery for escalation timers.
- LISTEN/NOTIFY for cross-instance WS broadcast: Postgres is already in the stack, < 50ms latency, no extra dep.
- Advisory locks for the poller: zero leader-election logic, automatic load balancing across instances.
- ReactFlow + Dagre: lifted from faxmon-frontend; same 4 node types (Condition, LogicalOperator, Action, RuleOutput); auto-layout LR.

## 4. Architecture overview

```
                       ┌──────────────────────┐
   browser  ────►  Next.js frontend  ─────►   │  Axum backend (N instances)
                       │  (rewrite /auth/* /api/* /ws /webhooks/*)         │
                       └──────────────────────┘
                                                                │
   Clever Cloud webhooks ──► POST /webhooks/cc/:token ──► [produce] ──► Pulsar `cc-webhooks` (30d)
                                                                                       │
                                                                                       ▼
                                                                  [Shared sub] consumer on each instance
                                                                                       │
                                                                  parse → dedup → state transition
                                                                                       │
                                                            ┌──────────────────────────┴────────────────────────────┐
                                                            ▼                                                       ▼
                                                  RuleEvaluator (chain)                                    pg_notify('ws_broadcast')
                                                            │                                                  │
                                  ┌─────────────────────────┼─────────────────────────┐                       ▼
                                  ▼                         ▼                         ▼          LISTEN bridge → org_buses → WS clients
                            SetMonitorState           SendNotification            Escalate
                                  │                         │                         │
                                  └──── re-trigger          └─→ handlebars            └─→ Pulsar `rule-escalations`
                                       dependent rules           render → adapter           (delayed) → consumer → re-evaluate
                                       (anti-loop, depth≤8)

   Tokio MonitorPoller (every 60s, on every instance, advisory-locked per monitor)
        │
        └─► query Warp10 → write metric_samples → trigger dependent rules
```

## 5. Repo layout

```
myccmonitor/
├── CLAUDE.md
├── README.md
├── docker-compose.dev.yml       ← Postgres + Pulsar standalone
├── .env.example
├── backend/
│   ├── Cargo.toml
│   ├── migrations/
│   └── src/
│       ├── main.rs              ← bootstrap: config → db → pulsar topics → routes → background tasks
│       ├── config.rs            ← typed Config from env, fail fast
│       ├── auth/                ← OAuth 1.0a CC (lifted from myccmetrics)
│       ├── api/                 ← cc_client.rs (lifted from mycctown)
│       ├── db/                  ← users, monitors, alerts, webhook_configs, channels, dedup, rules, rule_versions, rule_dependencies, rule_firings, monitor_state_history, monitor_groups
│       ├── handlers/            ← /auth, /api, /webhooks/cc/:token, /ws
│       ├── monitors/            ← MonitorPoller, advisory locks, metric_samples + state_history writes
│       ├── groups/              ← monitor_groups CRUD, auto-grouping rules, state rollup
│       ├── rules/               ← workflow engine: Condition tree, Action exec, RuleEvaluator, dependency index, cooldown, versioning, cycle detection
│       ├── notifications/       ← NotificationAdapter trait + email/slack/discord/webhook + handlebars rendering
│       ├── ws/                  ← WS hub, frames, LISTEN/NOTIFY bridge
│       ├── webhooks/            ← receiver, event parser (lifted from mycctown)
│       └── bus/                 ← Pulsar producer/consumer for `cc-webhooks` and `rule-escalations` topics
├── frontend/
│   ├── package.json
│   ├── next.config.js
│   └── src/
│       ├── app/
│       │   ├── (auth)/login/, (auth)/callback/
│       │   └── (app)/
│       │       ├── orgs/, orgs/[id]/         ← org list + per-org dashboard
│       │       ├── monitors/                  ← monitor CRUD + synthetic
│       │       ├── groups/                    ← group CRUD + auto-grouping config
│       │       ├── rules/                     ← rule list + visual editor route
│       │       ├── rules/new/                 ← new rule (ReactFlow blank canvas)
│       │       ├── rules/[id]/                ← edit rule (ReactFlow + version history)
│       │       ├── alerts/                    ← rule_firings + alerts history
│       │       └── channels/                  ← notification channels CRUD
│       ├── components/
│       │   ├── RuleEditor/                    ← lifted from faxmon-frontend
│       │   │   ├── RuleEditor.tsx             ← canvas, ruleToGraph / graphToRule, dagre layout
│       │   │   └── Nodes/
│       │   │       ├── ConditionNode.tsx      ← target (monitor|group), property, op, value, for-duration
│       │   │       ├── LogicalOperatorNode.tsx
│       │   │       ├── ActionNode.tsx         ← type (setMonitorState | sendNotification | escalate), templated fields
│       │   │       └── RuleOutputNode.tsx
│       │   └── ...
│       ├── hooks/, store/, services/
└── clevercloud/
    └── deploy.json
```

## 6. Domain model (Postgres)

```sql
users (
  id UUID PK,
  cc_user_id TEXT UNIQUE NOT NULL,           -- from /v2/self
  email TEXT, display_name TEXT,
  oauth_token_enc BYTEA NOT NULL,            -- AES-256-GCM
  oauth_secret_enc BYTEA NOT NULL,           -- AES-256-GCM
  oauth_nonce BYTEA NOT NULL,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
);

orgs (
  id UUID PK,
  user_id UUID REFERENCES users,
  cc_org_id TEXT NOT NULL,
  name TEXT, avatar_url TEXT,
  UNIQUE(user_id, cc_org_id)
);

webhook_configs (
  id UUID PK,
  user_id UUID REFERENCES users,
  cc_org_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,                -- 32 random bytes b64url
  cc_webhook_id TEXT,
  subscribed_events TEXT[],
  last_received_at TIMESTAMPTZ,
  failure_count INT DEFAULT 0,
  created_at TIMESTAMPTZ
);

monitors (
  id UUID PK,
  user_id UUID REFERENCES users,
  cc_org_id TEXT,                            -- nullable for synthetic
  kind TEXT NOT NULL,                        -- 'cc_application' | 'cc_addon' | 'synthetic'
  cc_resource_id TEXT,                       -- app_xxx | addon_xxx ; null for synthetic
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  poll_interval_seconds INT DEFAULT 60,      -- ignored if kind='synthetic'
  current_state TEXT NOT NULL DEFAULT 'unknown',  -- 'ok' | 'warning' | 'critical' | 'unknown'
  current_message TEXT,
  current_state_since TIMESTAMPTZ,
  last_poll_at TIMESTAMPTZ,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB                             -- tags, env, zone, …
);

monitor_state_history (                      -- needed for `for Xm` conditions
  monitor_id UUID NOT NULL REFERENCES monitors ON DELETE CASCADE,
  state TEXT NOT NULL,
  message TEXT,
  changed_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,                      -- 'webhook' | 'poller' | 'rule_action' | 'manual'
  PRIMARY KEY (monitor_id, changed_at)
);                                           -- retention 30d

metric_samples (                             -- sliding window for metric `for Xm` conditions
  monitor_id UUID NOT NULL REFERENCES monitors ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  cpu DOUBLE PRECISION, mem DOUBLE PRECISION, disk DOUBLE PRECISION,
  net_in DOUBLE PRECISION, net_out DOUBLE PRECISION,
  PRIMARY KEY (monitor_id, ts)
);                                           -- retention 24h

monitor_groups (
  id UUID PK,
  user_id UUID REFERENCES users,
  name TEXT NOT NULL,
  description TEXT,
  auto_rules JSONB,                          -- {name_pattern?, tags?, kinds?, env?} — AND
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
);

monitor_group_members (                      -- manual members (auto-matching computed at read time)
  group_id UUID REFERENCES monitor_groups ON DELETE CASCADE,
  monitor_id UUID REFERENCES monitors ON DELETE CASCADE,
  PRIMARY KEY (group_id, monitor_id)
);

rules (
  id UUID PK,
  user_id UUID REFERENCES users,
  name TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  condition JSONB NOT NULL,                  -- recursive tree (see §10)
  actions JSONB NOT NULL,                    -- list (see §10)
  cooldown_seconds INT NOT NULL DEFAULT 300, -- 5 min
  last_fired_at TIMESTAMPTZ,
  last_outcome_state TEXT,                   -- to allow recovery-exempt cooldown
  metadata JSONB,                            -- e.g. {preset: "threshold"} for UI-generated rules
  created_at TIMESTAMPTZ, last_modified_at TIMESTAMPTZ
);

rule_versions (                              -- last 5, auto-prune
  rule_id UUID REFERENCES rules ON DELETE CASCADE,
  version_id TEXT NOT NULL,                  -- v{unix_ts}
  rule JSONB NOT NULL,                       -- full snapshot
  comment TEXT,
  saved_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (rule_id, version_id)
);

rule_dependencies (                          -- index extracted from condition tree, recomputed at every save
  rule_id UUID REFERENCES rules ON DELETE CASCADE,
  ref_kind TEXT NOT NULL,                    -- 'monitor' | 'group'
  ref_id UUID NOT NULL,
  PRIMARY KEY (rule_id, ref_kind, ref_id)
);                                           -- index on (ref_kind, ref_id) for inverse lookup

rule_firings (                               -- audit + cooldown enforcement + UI history
  id UUID PK,
  rule_id UUID REFERENCES rules,
  user_id UUID REFERENCES users,
  fired_at TIMESTAMPTZ NOT NULL,
  trigger_kind TEXT NOT NULL,                -- 'monitor_update' | 'rule_chain' | 'poll' | 'webhook' | 'escalation'
  trigger_ref UUID,
  outcome TEXT NOT NULL,                     -- 'matched' | 'not_matched' | 'cooldown_skipped' | 'error'
  actions_executed JSONB,
  error_message TEXT
);                                           -- retention 30d

notification_channels (
  id UUID PK,
  user_id UUID REFERENCES users,
  kind TEXT NOT NULL,                        -- 'email' | 'slack' | 'discord' | 'webhook'
  name TEXT,
  config JSONB NOT NULL,                     -- shape depends on kind, see §13
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  failure_count INT NOT NULL DEFAULT 0
);

alerts (                                     -- materialized notification log (1 row per outbound notification)
  id UUID PK,
  user_id UUID REFERENCES users,
  monitor_id UUID REFERENCES monitors,
  rule_id UUID REFERENCES rules,
  level TEXT NOT NULL,                       -- 'warning' | 'critical' | 'recovered' | 'info'
  message TEXT,
  payload JSONB,
  notified_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

webhook_dedup (                              -- cross-instance dedup, 60s window
  key TEXT PRIMARY KEY,                      -- "{event}|{resource_id}|{deployment_id}"
  expires_at TIMESTAMPTZ NOT NULL
);                                           -- purged every 5 min

-- sessions: managed by tower-sessions-sqlx-store
```

## 7. OAuth 1.0a Clever Cloud

Lift from `myccmetrics/backend-server/src/auth/oauth.rs`. Do not reimplement.

1. `GET /auth/login` → `request_temporary_token()` → 303 to `https://api.clever-cloud.com/v2/oauth/authorize?oauth_token=…`. The request token *secret* is encrypted (AES-GCM) into a 5-min HTTP-only cookie `oauth_state`, so the callback works without prior session state.
2. CC redirects to `GET /auth/callback?oauth_token=…&oauth_verifier=…`
3. `exchange_access_token()` → `(access_token, access_secret)`
4. Signed `GET /v2/self` → upsert `users` row with AES-256-GCM-encrypted tokens. The `oauth_nonce` column holds the two AES-GCM nonces concatenated (`token_nonce[12] || secret_nonce[12]`).
5. Session set via tower-sessions (`session.insert("user_id", user.id)`); 303 to `${PUBLIC_BASE_URL}/orgs`.

**Consumer key/secret are NOT public.** myccmonitor needs its own OAuth consumer per environment, registered with the right callback URL — the public `clever-tools` key returns CC error 13502 *"OAuth callback is invalid"* when you try to use an arbitrary callback. Create it with `clever oauth-consumers create` (see §2 Quick start).

## 8. Webhook lifecycle

**Auto-create (1-click):**
1. User picks an org from `/v2/organisations`.
2. Backend generates a 32-byte token, b64url-encoded.
3. Backend calls signed CC API to create the webhook on the org. Endpoint candidate: `POST /v2/notifications.webhooks?ownerId=…`. Subscribed events: `APPLICATION_CREATION`, `APPLICATION_DELETION`, `APPLICATION_REDEPLOY`, `APPLICATION_STOP`, `GIT_PUSH`, `DEPLOYMENT_SUCCESS`, `DEPLOYMENT_FAIL`, `ADDON_CREATION`, `ADDON_DELETION`. URL = `${PUBLIC_BASE_URL}/webhooks/cc/{token}`. Format `raw`.
4. Insert into `webhook_configs`.

If the auto-create endpoint changes or fails, fall back to manual setup instructions in the UI (v1.1 contingency).

**Receive (any instance):**
1. `POST /webhooks/cc/:token` → look up token in `webhook_configs`. 404 if unknown.
2. Wrap raw body into a `BusMessage { token, user_id, cc_org_id, raw_body, received_at }`.
3. Produce on Pulsar topic `cc-webhooks` with `partition_key = cc_org_id`.
4. Reply `200 OK` immediately (target latency < 100ms).

**Process (Pulsar consumer, `Shared` subscription `myccmonitor-processor`, every instance):**
1. Dedup: `INSERT INTO webhook_dedup(key, expires_at) VALUES (…, now()+60s) ON CONFLICT DO NOTHING`. Conflict → drop.
2. Parse via `WebhookEnvelope` (lifted from `mycctown`) → `Vec<WsFrame>`.
3. For each frame: update `monitors.current_state` if applicable; if state transition, insert `monitor_state_history`, `pg_notify('ws_broadcast', {...})`, **trigger dependent rules** via `RuleEvaluator` (see §10).
4. Ack the Pulsar message. On panic/error: don't ack → retry with backoff → DLQ after N attempts.

**"Not monitored" UX:** if no `webhook_configs` row exists for a monitor's org, frontend shows a grey badge and a "Setup webhook" CTA.

## 9. Pulsar event bus

Topics, both created at boot via `ensure_topic_exists` (idempotent):

| Topic | Retention | Purpose | Subscription |
| --- | --- | --- | --- |
| `cc-webhooks` | 30 days | Inbox + audit log | `myccmonitor-processor` (Shared) — load-balanced across instances |
| `rule-escalations` | 1 day | Delayed messages for `Action::Escalate` | `myccmonitor-escalator` (Shared) — re-evaluates target rule when message arrives |

Replay/audit: `GET /api/admin/replay?org_id=…&from=…&to=…` instantiates a Pulsar `Reader` on `cc-webhooks` from a given timestamp; returns matching events; does **not** re-trigger processing.

## 10. Workflow engine

Conceptually lifted from faxmon (`faxmon-backend/internal/services/rule_service_impl.go`, `faxmon-backend/internal/repositories/rule_repository.go`, `faxmon-frontend/src/components/RuleEditor/`), adapted to the CC domain with four key fixes.

### 10.1 Condition tree

```rust
enum Condition {
    Comparison {
        field: String,                    // "monitor:{uuid}:state" | "group:{uuid}:state" | "monitor:{uuid}:cpu" | …
        operator: CompOp,                 // Eq | Neq | Gt | Lt | Gte | Lte | Contains | NotContains
        value: serde_json::Value,
        for_duration: Option<Duration>,   // optional: condition must hold for at least this duration
    },
    Logical {
        op: LogicalOp,                    // And | Or
        children: Vec<Condition>,
    },
}
```

**Field properties:**

| Prefix | Properties | Source |
| --- | --- | --- |
| `monitor:{uuid}` | `state`, `message`, `acknowledged`, `cpu`, `mem`, `disk`, `net_in`, `net_out`, `last_deploy_status` | Monitor row + latest `metric_samples` row |
| `group:{uuid}` | `state` (rolled-up), `critical_count`, `warning_count`, `total_count` | Computed from members on demand |

**Time-based:** `monitor:X:state == critical for 5m` is true iff the most recent `monitor_state_history` row showing `state=critical` for X is at least 5 min old AND no transition to a different state has happened since. One SQL query per condition.

### 10.2 Actions

```rust
enum Action {
    SetMonitorState {                     // chains: writes to a monitor (CC or synthetic)
        target_monitor_id: Uuid,
        state: MonitorState,
        message: Option<String>,          // handlebars
        acknowledged: Option<bool>,
    },
    SendNotification {
        channel_id: Uuid,
        message: String,                  // handlebars
        subject: Option<String>,          // for email
    },
    Escalate {                            // wait + chain
        delay_seconds: u32,
        target_rule_id: Uuid,
    },
}
```

Multiple actions per rule, executed in **parallel** via Tokio.

### 10.3 Evaluator

```
evaluate(rule, trigger_ref) -> Outcome
  1. Cooldown check: rule.last_fired_at + cooldown > now AND verdict unchanged → Cooldown
  2. Recursive evaluate(rule.condition) with short-circuit AND/OR
  3. If false → NotMatched
  4. If true → set last_fired_at + last_outcome_state; execute actions in parallel
  5. Insert rule_firings(...)
  6. For each SetMonitorState: re-trigger dependent rules (via rule_dependencies index, anti-loop, depth ≤ 8)
```

### 10.4 Chaining and anti-loop

Adapted from faxmon:
- `rule_dependencies` index recomputed on every CREATE/UPDATE (extracted from `field` references in the condition tree). Inverse query: `(monitor_id) → [rule_id, …]`.
- When a monitor changes state (from webhook, poller, or `SetMonitorState` action) → query dependent rules → evaluate them in parallel.
- **In-flight guard:** `DashMap<Uuid, ()>` of monitors currently being mutated by a chain; a `SetMonitorState` whose target is already in flight is skipped with a `warn!` log.
- **Max chain depth:** `RULE_CHAIN_MAX_DEPTH = 8`. Beyond that, abort with an `error!` log. Defense-in-depth even if static cycle detection misses an indirect loop (e.g. via auto-matched groups).
- **Static cycle detection:** at rule save time, build a directed graph `rules → monitors-they-write → rules-that-watch-those-monitors` with `petgraph`; reject save if `is_cyclic_directed`. Faxmon does NOT do this — known source of bugs. We do.

### 10.5 Cool-down

- `rules.cooldown_seconds` (default 300, min 0). Configurable in the editor.
- After a positive evaluation, `last_fired_at` is updated. Subsequent positive evaluations within `last_fired_at + cooldown` produce outcome `cooldown_skipped`.
- **Recovery-exempt:** if the outcome state changes (e.g. warning → critical, or critical → recovered), bypass the cool-down so transitions always fire.

### 10.6 Versioning, validation, API

- On CREATE/UPDATE → snapshot to `rule_versions` with `version_id = v{unix_ts}`. Auto-prune to last 5.
- Save validates: (a) every field reference exists and belongs to the same `user_id`; (b) every action target (monitor, channel, rule) belongs to the same `user_id`; (c) the DAG has no cycle (§10.4); (d) at least one action.
- Endpoints:
  - `GET /api/rules`, `POST /api/rules`
  - `GET /api/rules/:id`, `PUT /api/rules/:id`, `DELETE /api/rules/:id`
  - `GET /api/rules/:id/versions`
  - `POST /api/rules/:id/versions/:version_id/restore`
  - `POST /api/rules/:id/test` — dry-run against current state, returns the would-be outcome and which actions would have fired.

### 10.7 Synthetic monitors

A monitor with `kind='synthetic'` has no CC backing. Its state is mutated **only** by `SetMonitorState` actions. Use case: `prod_health` is synthetic; a rule `if any(prod-app-*) critical → set prod_health critical` materializes a roll-up; a second rule `if prod_health critical for 10m → escalate` watches the synthetic. UI marks them with a "synthetic" badge.

### 10.8 UI presets ("Quick threshold")

For a single CC monitor, the UI offers a one-click "Quick threshold" form: `cpu > 80 → setMonitorState warning + sendNotification`. This generates a normal `rules` row with `metadata.preset = "threshold"`, allowing later re-edit in form mode as long as the graph hasn't been touched manually.

## 11. ReactFlow visual editor

Lifted from `faxmon-frontend/src/components/RuleEditor/RuleEditor.tsx` and the four nodes under `Nodes/`. Adaptations:

- **4 node types:** `ConditionNode`, `LogicalOperatorNode`, `ActionNode`, `RuleOutputNode`.
- **`ConditionNode`** — selects target (monitor/group, scoped to current user), property (from the schema in §10.1), operator, value, and an optional "for duration" input (`5m`, `30s`, `2h`).
- **`LogicalOperatorNode`** — `and` / `or`, dynamic input handles count.
- **`ActionNode`** — selects action type (`setMonitorState` / `sendNotification` / `escalate`); fields adapt; `message` and `subject` get handlebars autocompletion (`{{monitor.…}}`, `{{rule.name}}`, `{{trigger.…}}`).
- **`RuleOutputNode`** — terminal node; multiple `ActionNode`s connect on its right (parallel execution).
- **Round-trip:** `ruleToGraph` / `graphToRule` lifted; extended for new fields. JSON shape persisted is the `Condition` / `Action` types from §10.
- **Layout:** Dagre `LR` (left → right), `network-simplex` ranker, `acyclicer: greedy`. Re-layout button in the UI.
- **Cycle warning:** if the backend rejects save due to cycle, the editor highlights the offending nodes and shows the cycle path.

## 12. Monitor groups

Organizational layer + first-class addressable in rules.

**Auto-grouping rules** (stored as `monitor_groups.auto_rules` JSONB, all conjunctive):
- `name_pattern` — regex on `monitors.display_name`
- `tags` — substring match on `monitors.metadata.tags`
- `kinds` — list of `monitor.kind` to include
- `env` — match on `monitors.metadata.env`

**Manual members** in `monitor_group_members`. Effective members = manual ∪ auto-matched, computed on read.

**State rollup:** `state = critical` if any member critical, else `warning` if any member warning, else `ok`. Counts are returned alongside.

**Addressable in rules** via `group:{group_id}:state`, `group:{group_id}:critical_count`, etc. (See §10.1.) Faxmon does not support this.

## 13. Notification channels & templating

Trait:
```rust
#[async_trait]
trait NotificationAdapter {
    async fn send(&self, ctx: &NotifContext) -> anyhow::Result<()>;
}
```

`NotifContext` carries `{ monitor, group, rule, trigger, alert, user_locale }`. Adapters pull format-specific fields from `notification_channels.config`:

| kind     | `config` shape                                                 |
| -------- | -------------------------------------------------------------- |
| email    | `{to: ["a@b"], reply_to?, subject_prefix?}` — uses SMTP env    |
| slack    | `{webhook_url: "https://hooks.slack.com/…"}`                   |
| discord  | `{webhook_url: "https://discord.com/api/webhooks/…"}`          |
| webhook  | `{url, method?: "POST", headers?: {…}}` — generic POST JSON   |

**Templating (handlebars):** before `send`, `message` and `subject` go through handlebars with the full `NotifContext`. Custom helpers: `{{since ts}}`, `{{relative_time ts}}`, `{{format_state state}}`. If a user leaves the message blank, a default template is used: `"{{monitor.display_name}} is {{format_state monitor.current_state}} (rule: {{rule.name}})"`.

**Dispatcher:** invoked by `RuleEvaluator` for each `SendNotification` action. Resolves `notification_channels.config`, renders the template, calls the adapter. On error: log + 3× retry with exponential backoff (1s, 4s, 16s) + increment `notification_channels.failure_count`. No persistent queue in v1.

## 14. Real-time WebSocket + LISTEN/NOTIFY

**Why LISTEN/NOTIFY:** with multi-instance, in-process `broadcast::Sender` only fans out within one instance. LISTEN/NOTIFY uses Postgres (already there) to fan out cross-instance with < 50ms latency. Payload limit: 8000 bytes — frame JSONs fit comfortably.

**Backend per-instance setup:**
- One dedicated Postgres connection runs `LISTEN ws_broadcast`. A Tokio task reads notifications, parses `{org_id, frame}`, pushes onto a local `org_buses: DashMap<String, broadcast::Sender<WsFrame>>`.
- Producers (Pulsar consumer, MonitorPoller, RuleEvaluator) call `pg_notify('ws_broadcast', json_payload)` — they do **not** push to `org_buses` directly. Every event must go through Postgres so all instances see it.
- `GET /ws?org=cc_org_id` upgrades. Auth: session must exist and own the org. Subscribes to local `org_buses[org_id]`.

**Frame types** (JSON, tagged by `type`):
- `MonitorState { monitor_id, state, since, message }`
- `GroupState { group_id, state, breakdown: {critical, warning, ok, unknown} }`
- `MetricsSnapshot { monitor_id, cpu, mem, disk, net_in, net_out, ts }`
- `Alert { id, level, message, monitor_id, rule_id, created_at }`
- `RuleFiring { rule_id, rule_name, outcome, fired_at, trigger_kind, trigger_ref }`
- `WebhookHealth { org_id, last_received_at }`

**Frontend:** `useOrgWebSocket(orgId)` keeps the connection up, exponential reconnect (1s, 2s, 5s, max 30s). On reconnect, also call `GET /api/orgs/:id/state` to resync; the API is idempotent.

## 15. Multi-tenant isolation

**The rule, no exceptions:** every query that reads or writes a tenant-scoped row MUST filter by `user_id` from the session. There is no admin bypass in v1. PR review must reject any query missing this clause.

**Specific to the workflow engine:** at rule save time, validate that every `target_monitor_id`, `target_rule_id`, `channel_id`, and field-referenced monitor/group belongs to the same `user_id` as the rule. Otherwise return 403. This prevents cross-tenant leakage via crafted rules.

**At rest:** `oauth_token_enc`, `oauth_secret_enc` are AES-256-GCM-encrypted with `APP_ENCRYPTION_KEY`. Plaintext exists only in memory while signing CC API calls.

**Webhook tokens** are bound to `(user_id, cc_org_id)` in `webhook_configs`. A leaked token only lets an attacker push events for that pair.

**Session ownership:** `GET /ws?org=…` and every `/api/orgs/:id/*` endpoint verifies `orgs.user_id = session.user_id` before returning data.

## 16. Multi-instance & advisory locks

Backend runs ≥ 2 instances in prod. Multi-instance coordination strategy:

**Polling (per-monitor advisory lock):**
```
1. SELECT id FROM monitors WHERE enabled AND last_poll_at < now() - poll_interval AND kind <> 'synthetic'
2. for each candidate:
   a. lock = pg_try_advisory_xact_lock(hashtext('monitor:' || id))   -- non-blocking, txn-scoped
   b. if not acquired: skip (another instance owns it)
   c. fetch Warp10 metrics → INSERT metric_samples → trigger dependent rules
   d. if state transition: INSERT monitor_state_history, UPDATE monitors, pg_notify
   e. UPDATE monitors.last_poll_at
   f. (lock auto-released at txn end)
```

Connection-level locks are released on connection death, so a crashed poller does not deadlock. `xact` variant ensures release on commit/rollback even if the connection is later mis-recycled.

**Webhook dedup** is cross-instance (Postgres-backed, see §6).

**Rule firing** is per-instance: whichever instance consumed the Pulsar message OR ran the poll cycle owns the rule evaluation and notification dispatch. The chain stays local; cross-instance broadcast happens only via `pg_notify` for the WS layer.

## 17. Deployment on Clever Cloud

**Apps:**
- `myccmonitor-frontend` — Node.js runtime, `next build && next start -p $PORT`.
- `myccmonitor-backend` — Rust runtime, `cargo build --release`. **Scale to ≥ 2 instances in prod.**
- Single-origin: the frontend rewrites `/auth/*`, `/api/*`, `/ws`, `/webhooks/*` to the backend.

**Addons:**
- Postgres — sessions, data, LISTEN/NOTIFY, advisory locks. Provides `POSTGRESQL_ADDON_URI`.
- Pulsar — provides `PULSAR_BINARY_URL`, `PULSAR_TOKEN`, `PULSAR_TENANT`, `PULSAR_NAMESPACE`. Two topics created at boot: `cc-webhooks` (30d retention) and `rule-escalations` (1d retention).

**Env vars** (also in `.env.example`):

| Var                    | Where set | Purpose                                                  |
| ---------------------- | --------- | -------------------------------------------------------- |
| `CC_CONSUMER_KEY`      | env       | OAuth 1.0a consumer key (public)                         |
| `CC_CONSUMER_SECRET`   | env       | OAuth 1.0a consumer secret (public)                      |
| `APP_ENCRYPTION_KEY`   | env       | 32 bytes hex — AES-256-GCM key for user OAuth tokens     |
| `POSTGRESQL_ADDON_URI` | addon     | DB URL                                                   |
| `PULSAR_BINARY_URL`    | addon     | `pulsar+ssl://…:6651`                                    |
| `PULSAR_TOKEN`         | addon     | JWT for Pulsar auth                                      |
| `PULSAR_TENANT`        | addon     | tenant for topics                                        |
| `PULSAR_NAMESPACE`     | addon     | namespace for topics                                     |
| `PUBLIC_BASE_URL`      | env       | OAuth callback + webhook URL base                        |
| `SMTP_HOST/USER/PASS/FROM` | env   | Email adapter                                            |
| `INSTANCE_ID`          | CC env    | Provided by CC, used for instance-scoped Pulsar subs     |

**Runbook:**
- Login broken → check `CC_CONSUMER_KEY` / `CC_CONSUMER_SECRET` and that callback URL matches `${PUBLIC_BASE_URL}/auth/callback`.
- No WS frames in dashboard → verify Postgres LISTEN connection alive (`SELECT * FROM pg_stat_activity WHERE query LIKE '%LISTEN%'`); confirm producers actually call `pg_notify`.
- Webhook events not arriving → check `webhook_configs.last_received_at`; check Pulsar topic backlog (`pulsar-admin topics stats`).
- Rule never fires → check `rule_dependencies` was rebuilt at last save; check `rule_firings` for `cooldown_skipped` rows; use `POST /api/rules/:id/test` to dry-run against current state.
- Same monitor polled twice → advisory lock not held; verify the poll body wraps in a transaction with `pg_advisory_xact_lock`.
- Escalation never fires → check the `rule-escalations` consumer is running and topic subscription is active; verify Pulsar broker accepts `deliverAfter`.

## 18. Conventions

**Backend (Rust):**
- Errors: `anyhow::Result` at boundaries, `thiserror` only when an error is part of an API contract. No `unwrap()` outside tests and `main.rs` boot.
- Logging: `tracing` with structured fields (`user_id`, `org_id`, `monitor_id`, `rule_id`). No `println!`.
- Comments: only for non-obvious *why*. No "what" comments.
- Module layout: each domain (auth, webhooks, monitors, groups, rules, notifications…) is a sibling under `src/`. No "utils".
- Migrations: append-only. Never edit a shipped migration.
- Workflow engine code paths must reference `rule_id` in every `tracing` event for traceability.

**Frontend (Next.js):**
- Server components by default. `"use client"` only when needed.
- API calls go through `lib/api.ts`. No scattered `fetch`.
- Stores in `src/store/` are domain-specific. Persist sparingly.
- Tailwind first, shadcn/ui second, custom CSS last resort.
- `RuleEditor` is a client-only component. Mounted lazily on `/rules/new` and `/rules/[id]`.

**Both:**
- Every tenant-scoped query/handler MUST filter by `user_id`. Reviewer veto right.
- No backwards-compatibility shims. Delete unused code instead of marking it deprecated.

## 18.b Gotchas surfaced during Phase 2 (read this before debugging)

- **Migration loader.** `sqlx::migrate!()` (compile-time) doesn't pick up new `.sql` files on incremental builds, and `sqlx::migrate::Migrator::new(path).run(&pool)` silently no-ops in our setup. We use a custom 30-line runner in `main.rs` that reads the directory at runtime, executes each unapplied file via `sqlx::raw_sql`, and tracks applied versions in `_myccmonitor_migrations`. Migrations should be written with `CREATE TABLE IF NOT EXISTS` so re-runs are idempotent.
- **Env priority.** Both `DATABASE_URL`/`POSTGRESQL_ADDON_URI` and `PULSAR_BINARY_URL`/`ADDON_PULSAR_BINARY_URL` are read in that order: explicit dev override first, then the CC addon-injected variant. If both are set, the *first* wins. In dev, comment `POSTGRESQL_ADDON_URI` out of `.env` if you want to hit local Postgres — otherwise migrations land on the CC addon.
- **Pulsar producer name.** Must be unique per instance (we suffix with `instance_id` + a UUID). A fixed name causes `ProducerBusy` retries when a previous backend instance died without releasing the connection.

## 19. Useful commands

```bash
# Backend
cargo run
cargo test
cargo clippy --all-targets -- -D warnings
sqlx migrate add <name>
sqlx migrate run
cargo sqlx prepare

# Frontend
npm run dev
npm run lint
npm run build && npm run start

# Pulsar (against the addon)
pulsar-admin topics stats persistent://${PULSAR_TENANT}/${PULSAR_NAMESPACE}/cc-webhooks
pulsar-admin topics peek-messages -n 5 -s myccmonitor-processor persistent://.../cc-webhooks
pulsar-admin topics stats persistent://${PULSAR_TENANT}/${PULSAR_NAMESPACE}/rule-escalations

# Postgres
psql $POSTGRESQL_ADDON_URI
\dt
SELECT id, name, last_fired_at, cooldown_seconds FROM rules;
SELECT * FROM rule_firings ORDER BY fired_at DESC LIMIT 20;
SELECT pid, query FROM pg_stat_activity WHERE query LIKE '%LISTEN%';
```

## 20. Reuse from sibling projects under apple/

| Source                                                                        | Destination                            | Notes                                              |
| ----------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| `myccmetrics/backend-server/src/auth/oauth.rs`                                | `backend/src/auth/oauth.rs`            | Lift verbatim                                      |
| `mycctown/backend/src/api/cc_client.rs`                                       | `backend/src/api/cc_client.rs`         | Lift, add `create_webhook()`                       |
| `mycctown/backend/src/webhooks/event.rs`                                      | `backend/src/webhooks/event.rs`        | Lift, adapt `to_frames` to our frames              |
| `mycctown/backend/src/webhooks/receiver.rs`                                   | `backend/src/webhooks/receiver.rs`     | Adapt to produce on Pulsar                         |
| `mycctown/backend/src/metrics/warp10_client.rs`                               | `backend/src/metrics/warp10_client.rs` | Lift (~31 lines)                                   |
| `myccmetrics/backend-server/src/db/users.rs`                                  | `backend/src/db/users.rs`              | Adapt schema (we have `orgs` table)                |
| `faxmon-backend/internal/services/check_alive_service.go`                     | inspires `backend/src/monitors/poller.rs` | Tokio-interval pattern                          |
| **`faxmon-backend/internal/services/rule_service_impl.go`**                   | `backend/src/rules/{evaluator,actions}.rs` | Lift conceptually: recursive Condition, parallel actions, anti-loop mutex. Adapt: CC fields, cooldown, Escalate, templating |
| **`faxmon-backend/internal/repositories/rule_repository.go`**                 | `backend/src/db/rules.rs`              | Lift conceptually: versioning, FindDependentRules, prune-to-5 |
| **`faxmon-frontend/src/components/RuleEditor/RuleEditor.tsx` + `Nodes/*`**    | `frontend/src/components/RuleEditor/…` | Lift near-verbatim; adapt ConditionNode (target=monitor/group, property list, for-duration) and ActionNode (3 types) |
| **`faxmon-frontend/src/services/ruleService.ts`**                             | `frontend/src/services/ruleService.ts` | Lift, adapt to extended Rule schema                |
| `faxmon-backend/internal/models/models.go` (EventGroup, AutoGroupingRules)    | `backend/src/groups/model.rs`          | Adapt: `host_pattern` → `name_pattern`, `event_types` → `kinds`, keep rollup |
| `faxmon-frontend/src/store/eventStore.ts`                                     | inspires `frontend/src/store/monitorStore.ts` | Zustand persist                              |

## 21. Future work (v2+)

- Polling fallback if a webhook stops firing (heartbeat detection).
- Log pattern matching (subscribe to CC log SSE, regex alerts).
- Public status pages per org.
- On-call schedules + escalation chains beyond the simple `Escalate` action.
- Mobile push notifications + ack from mobile.
- DLQ inspector UI for failed Pulsar messages.
- Pulsar-everywhere: pipeline alerts and WS broadcast over Pulsar topics for stronger durability and easier scale-out.
- DSL-style text editor as an alternative front to the visual editor (`cpu > 80 for 5m AND env=prod` → graph).
- More action types: `runWebhook` with custom payload, `setMonitorMetadata`, `acknowledgeAlert`.
- Audit log of who edited each rule (track session `user_id` + IP at version save).
- `metric_samples` retention tuning per monitor.

## 22. Implementation log

Each phase committed in turn. Source of truth is `git log`; this list is a quick scan of where we are.

- ✅ **Phase 0** — Bootstrap. `cargo init backend` (compiles, all deps including pulsar resolve), `npx create-next-app frontend` (Next 16, React 19, Tailwind v4, reactflow + dagre + zustand installed), `docker-compose.dev.yml` (Postgres 16 + Pulsar 3.3.2 standalone, healthchecks), `.env.example`, `.gitignore`, `clevercloud/README.md` (CC bootstrap runbook), `backend/clevercloud/rust.json`. Backend module folders stubbed with `mod.rs` placeholders pointing at the phase that fills them. Host prerequisite: `protoc` (Homebrew `protobuf`).
- ✅ **Phase 1** — OAuth login + sessions + DB users + AES-GCM token encryption. SQL migration `users` table; AES-256-GCM helpers (encrypt/decrypt) lifted from myccmetrics; OAuth 1.0a 3-leg flow (`request_temporary_token`, `exchange_access_token`, `sign_api_request`) lifted; HTTP handlers `/auth/login`, `/auth/callback`, `/auth/logout`; tower-sessions Postgres store; cookie-based stash of the request_token_secret during the redirect. Smoke-tested: backend connects to Postgres, migrations apply, session store provisions itself, `/health` answers 200, `/auth/login` reaches CC and surfaces a clean error when the OAuth consumer is not configured. **Operator step**: run `clever oauth-consumers create` once per env (see §2) before the OAuth flow can succeed end-to-end.
- ✅ **Phase 2** — list orgs + auto-create webhook + Pulsar producer/consumer. Migrations for `orgs`, `webhook_configs`, `webhook_dedup`. DB modules with the same shape. CC API client `api/cc_client.rs` with `list_organisations` (lifted from mycctown) and new `create_webhook` (POST `/v2/notifications/webhooks/{ownerId}`, body `{name, urls:[{format,url}], events}`). `AuthenticatedUser` extractor that decrypts the OAuth `(token, secret)` pair from the session-resolved User row. Authenticated handlers `GET /api/me`, `GET /api/orgs` (refreshes the cache from CC then returns the user's orgs), `POST /api/orgs/:cc_org_id/webhook` (generates a 32-byte token, calls CC create_webhook, stores in `webhook_configs`). Public receiver `POST /webhooks/cc/:token` that authenticates by token, produces a `BusMessage` on Pulsar topic `cc-webhooks` with partition_key=cc_org_id, replies 204. Pulsar bus module with connect (with optional JWT auth for the CC addon), `WebhookProducer` (per-instance unique name to avoid `ProducerBusy` on reconnect), and a `Shared`-subscription consumer that parses + cross-instance-dedups via `webhook_dedup` and logs (Phase 3 will dispatch to monitors). Smoke-tested end-to-end against local docker Postgres + Pulsar standalone: fake `DEPLOYMENT_SUCCESS` POST → 204, consumer logs `webhook received event=DEPLOYMENT_SUCCESS`, second identical POST is deduped via `webhook_dedup` table.
- ✅ **Phase 3a** (backend) — monitors + monitor_state_history. Migrations 005+006 with partial unique indexes (`monitors_uniq_cc_resource` for CC-backed, `monitors_uniq_synthetic_name` for synthetics). DB modules `db/monitors.rs` (upsert_cc, find_by_cc_resource, set_state_if_changed, delete_*) + `db/monitor_state_history.rs` (insert, state_held_for, purge). CC API extended with `list_applications`/`list_addons`. `monitors/sync.rs` upserts apps+addons for an org and prunes the missing. Authenticated `GET /api/orgs/{cc_org_id}/monitors` triggers a sync and returns the list. WS module with `WsFrame::MonitorState` + `OrgBus` (DashMap broadcast channels per org) + `run_listen_notify` (PgListener-backed bridge: every backend instance LISTENs ws_broadcast and pushes to its local org channel) + `GET /ws?org=cc_org_id` upgrade handler that auths via session+org ownership. Pulsar consumer upgraded to map CC events → monitor state transitions: `APPLICATION_CREATION`/`ADDON_CREATION` upsert; `DEPLOYMENT_SUCCESS`→ok, `DEPLOYMENT_FAIL`/`APPLICATION_STOP`→critical, `REDEPLOY`/`GIT_PUSH`→unknown; `*_DELETION` drops the monitor. State changes persist to history and `pg_notify('ws_broadcast', {cc_org_id, frame})`. Smoke-tested: APPLICATION_CREATION → monitor row, DEPLOYMENT_SUCCESS → state=ok + history row, APPLICATION_DELETION → monitor removed.
- ✅ **Phase 3b** (frontend) — auth-aware home page (`/`) with login button, orgs list (`/orgs`) with one-click "Setup webhook" + drill-in, per-org dashboard (`/orgs/[ccOrgId]`) with monitor cards grouped by kind (cc_application / cc_addon / synthetic). `services/types.ts` mirrors backend JSON shapes; `services/api.ts` is a typed fetch wrapper that surfaces `ApiError { status }` for 401 redirects. `hooks/useOrgWebSocket.ts` opens WS to `/ws?org=…`, applies `MonitorState` frames live, exponentially backs off on disconnect (max 30s). `components/{StateBadge,MonitorCard}.tsx` plain-Tailwind v4 cards (shadcn deferred). `next.config.ts` proxies `/auth /api /ws /webhooks` to `BACKEND_INTERNAL_URL` (defaults `http://localhost:8080`). `npm run lint` + `npm run build` pass with the 4 app routes (`/`, `/orgs`, `/orgs/[ccOrgId]`, `/_not-found`).
- ✅ **Phase 4** — Warp10 poller + advisory locks + metric_samples. Migration 007 (`metric_samples`, PK monitor_id+ts, retention 24h purge by the poller every hour). `cc_client.get_metrics_token` (POST `/v2/metrics/read/{org_id}`, strips JSON-quoted body). New `metrics/` module: `warp10_client::execute_warpscript` (lifted from mycctown), `templates::cpu_ram_last_script` (FETCH cpu.usage_user + mem.used_percent for a batch of ids by `app_id`/`addon_id` label, MERGE'd) + `split_cpu_ram` walks the GTS tree and picks the latest raw point. `metrics::tokens::TokenCache` is a per-instance in-memory `DashMap<(user_id, cc_org_id), (token, expires_at)>` with 4h TTL — Warp10 read tokens are valid ~5d but a shorter cache window is cheap insurance. `monitors::poller::run` is a 60s Tokio interval task on every backend instance: SELECTs due monitors (`enabled AND kind <> 'synthetic' AND last_poll_at < now() - poll_interval_seconds * interval`), groups by (user_id, cc_org_id), per group loads + decrypts the user's OAuth tokens (helper `auth::decrypt_user_oauth` shared with the extractor), then for each kind (cc_application, cc_addon) issues one batched WarpScript and writes a `metric_samples` row per monitor. Per-monitor `pg_try_advisory_lock` (key = XOR of the UUID's two u64 halves) makes this multi-instance safe. Each successful sample broadcasts a `WsFrame::MetricsSnapshot { monitor_id, ts, cpu, mem }` via `pg_notify('ws_broadcast', …)` so the dashboard updates live. Frontend: `WsFrame` union extended with `metrics_snapshot`, dashboard maintains a `Record<monitor_id, MetricSnapshot>` keyed map populated from frames, `MonitorCard` renders horizontal CPU + MEM bars (green < 75%, amber 75–89%, rose ≥ 90%) below the state badge. **Phase 4 ships data collection only; threshold-driven state transitions are Phase 6's job (rules read `metric_samples`).** Smoke-tested locally: migration 007 applies, poller starts, no crash on empty monitor table.
- ✅ **Phase 5** — monitor groups (CRUD + auto-grouping + rollup + frontend). Migrations 008/009 (`monitor_groups`, `monitor_group_members`). `db/monitor_groups.rs` (CRUD + `add_member`/`remove_member` with cross-user validation). `groups/rollup.rs` computes the effective member set as `manual ∪ auto-matched` and the rolled-up state (`critical > warning > ok > unknown`). Auto-grouping rules in v1: `name_pattern` (regex on `monitors.display_name`, evaluated by the `regex` crate) + `kinds` (whitelist of `monitor.kind`); both conjunctive. `compute_view` returns a `GroupView { ...group, member_ids, rolled_state, state_breakdown { ok, warning, critical, unknown, total } }`. New REST surface under `/api/groups`: `GET` (list), `POST` (create), `GET/PUT/DELETE /:id`, `POST/DELETE /:id/members/:monitor_id`. Frontend: `/groups` lists groups with rolled-up badge + inline create form (name, description, optional `name_pattern`, kinds checkboxes) and a state-breakdown sub-line. `/groups/[id]` shows the auto-rules JSON, manual members with state badges + remove buttons, and a dropdown to add a monitor from any of the user's orgs (it fetches `listOrgs` + `listMonitors` per org concurrently). Top-right link from `/orgs` to `/groups` for navigation. Tag/env shortcuts deferred (the JSONB column already accepts unknown fields).
- ⏳ **Phase 6** — workflow engine: condition tree, action exec, rule_dependencies, cooldown, versioning, cycle detection, ReactFlow visual editor.
