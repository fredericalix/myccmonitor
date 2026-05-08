# myccmonitor — Developer Guide

A distillation of [`CLAUDE.md`](../CLAUDE.md) for English-only readers who want to contribute to the codebase. CLAUDE.md remains the canonical spec / phase log; this guide cross-references it for the source of truth on each subject.

For end-user documentation see [`USER_GUIDE.md`](./USER_GUIDE.md).

---

## 1. Mission and multi-tenant model

myccmonitor is a multi-tenant supervision tool for Clever Cloud applications and add-ons. Each Clever Cloud user who signs in gets an isolated workspace: their orgs, monitors, groups, rules, channels, and audit data are strictly partitioned by `users.id`.

**Hard rules** (PR review enforces them):

- Every database query that reads or writes a tenant-scoped row filters by `user_id` from the session. There is no admin bypass in v1.
- At rule save time, the backend validates that every `target_monitor_id`, `target_rule_id`, `channel_id`, and field-referenced monitor/group belongs to the same user as the rule. Cross-tenant references return 403 — see `backend/src/handlers/rules.rs::validate_action_refs`.
- OAuth access tokens are encrypted at rest with **AES-256-GCM** using `APP_ENCRYPTION_KEY`. Plaintext exists only in memory while signing CC API calls. See `backend/src/auth/`.
- Webhook tokens are bound to `(user_id, cc_org_id)` in `webhook_configs`. A leaked token only authorises events for that pair.

## 2. Tech stack

**Backend** — Rust 1.85+ (edition 2024), Axum 0.8, Tokio, sqlx 0.8 (Postgres), tower-sessions 0.14 + tower-sessions-sqlx-store, aes-gcm 0.10, reqwest 0.12, lettre 0.11 (SMTP), `pulsar` 6.x (`pulsar-rs`, requires `protoc` at build time), `petgraph` 0.6 (cycle detection), `handlebars` 6 (notification templating), `tracing`.

**Frontend** — Next.js **16** (app router; **breaking changes from Next 15** — read `frontend/AGENTS.md` and `frontend/node_modules/next/dist/docs/` before writing Next-specific code), TypeScript 5, React 19.2, Zustand 5, **Tailwind CSS v4** (CSS-only theme via `@theme` in `frontend/src/app/globals.css`), hand-rolled UI primitives (no shadcn), `@phosphor-icons/react`, `sonner`, ReactFlow 11 + Dagre.

**Infra** — Postgres (data + sessions + LISTEN/NOTIFY + advisory locks), Apache Pulsar (durable webhook inbox + 30-day audit retention + delayed messages for rule escalations), Clever Cloud as deploy target.

**Why these picks**

- Rust + Axum + Postgres + AES-GCM matches sibling projects under `apple/` (myccmetrics, mycctown). Proven OAuth + CC API code is lifted from there.
- Pulsar gives us zero event loss across restarts; the topic retention doubles as an audit log; native delayed-delivery handles escalations.
- Postgres `LISTEN/NOTIFY` for cross-instance WebSocket fan-out costs nothing extra (Postgres is already in the stack), latency under 50 ms, no Redis dependency.
- Per-monitor advisory locks (`pg_try_advisory_xact_lock`) make the poller multi-instance-safe with zero leader election logic.

## 3. Repository layout

```
myccmonitor/
├── CLAUDE.md                       canonical spec / agent doc / phase log
├── README.md                       short entry point
├── docs/
│   ├── USER_GUIDE.md               end-user walkthrough
│   └── DEVELOPER_GUIDE.md          this file
├── docker-compose.dev.yml          Postgres 16 + Pulsar 3.3 standalone
├── .env.example
├── backend/
│   ├── Cargo.toml
│   ├── migrations/                 sequenced SQL files
│   └── src/
│       ├── main.rs                 boot: config → DB → migrations → Pulsar → AppState → spawn tasks → routes
│       ├── config.rs               typed Config from env
│       ├── auth/                   OAuth 1.0a CC, AES-GCM, AuthenticatedUser extractor
│       ├── api/cc_client.rs        signed CC API client (lifted from mycctown)
│       ├── db/                     SQLx-backed repositories, one file per table
│       ├── handlers/               Axum routes (api, rules, channels, groups, ws, webhooks)
│       ├── monitors/               60s poller, state map, advisory locks
│       ├── groups/                 CRUD, auto-grouping, rolled-up state
│       ├── rules/                  workflow engine: condition / evaluator / dependencies
│       │                           cycle / actions / exec / debug
│       ├── notifications/          adapter trait + 4 impls + handlebars + dispatch + retry
│       ├── ws/                     OrgBus, LISTEN/NOTIFY bridge, frame types
│       ├── webhooks/               receiver + event parser
│       └── bus/                    Pulsar producer + consumers (cc-webhooks, rule-escalations)
├── frontend/
│   ├── package.json
│   ├── next.config.ts              proxies /auth /api /ws /webhooks to backend
│   └── src/
│       ├── app/
│       │   ├── page.tsx            public landing
│       │   ├── layout.tsx          Geist Mono + Inter Tight + Instrument Serif fonts; theme bootstrap
│       │   └── (app)/              authenticated routes share AppShell
│       │       ├── layout.tsx      AppShell + Toaster
│       │       ├── orgs/, orgs/[ccOrgId]/
│       │       ├── groups/, groups/[id]/
│       │       ├── rules/, rules/new/, rules/[id]/
│       │       └── channels/
│       ├── components/
│       │   ├── ui/                 hand-rolled primitives (Button, Card, Dialog, …)
│       │   ├── layout/             AppShell, Sidebar, ThemeToggle, PageHeader, WSIndicator
│       │   └── RuleEditor/         ReactFlow canvas + Nodes/* + DebugPanel
│       ├── hooks/useOrgWebSocket.ts  auto-reconnecting WS hook with exposed connection state
│       ├── services/api.ts           typed fetch wrapper
│       └── lib/cn.ts                 clsx + tailwind-merge helper
└── clevercloud/                    deploy assets
```

## 4. Local development setup

**Prerequisites**

- Rust 1.85+ (`rustup`).
- Node 22+ (Next 16 + React 19.2 require recent Node).
- `protoc` for the `pulsar` crate. macOS: `brew install protobuf`. Linux: package manager.
- Docker for the dev Postgres + Pulsar.

**One-time setup**

```bash
git clone <repo> && cd myccmonitor
cp .env.example .env

# Generate the at-rest token encryption key
openssl rand -hex 32                              # paste into APP_ENCRYPTION_KEY in .env

# Register a Clever Cloud OAuth consumer for this environment.
# The public clever-tools key does NOT accept arbitrary callbacks (CC error
# 13502). See CLAUDE.md §7 for details.
clever oauth-consumers create myccmonitor-dev \
    --description "myccmonitor (dev)" \
    --url        "http://localhost:3000" \
    --base-url   "http://localhost:3000" \
    --rights     "access-personal-information,access-organisations,manage-organisations-applications,manage-organisations-services"
clever oauth-consumers get <key> --with-secret
# Paste the key + secret into CC_CONSUMER_KEY / CC_CONSUMER_SECRET in .env.
```

**Run**

```bash
docker compose -f docker-compose.dev.yml up -d        # Postgres + Pulsar standalone
cd backend && cargo run                               # runs migrations on boot, listens :8080
cd frontend && npm install && npm run dev             # http://localhost:3000
```

The Next dev server proxies `/auth/*`, `/api/*`, `/ws`, and `/webhooks/*` to `BACKEND_INTERNAL_URL` (defaults to `http://localhost:8080`).

**Tip — env priority.** Both `DATABASE_URL` / `POSTGRESQL_ADDON_URI` and `PULSAR_BINARY_URL` / `ADDON_PULSAR_BINARY_URL` are read in that order: explicit dev override first, then the CC-injected variant. If both are set, the *first* wins. In dev, comment `POSTGRESQL_ADDON_URI` out of `.env` if you want to hit the local Docker Postgres — otherwise migrations will land on the CC addon.

## 5. Architecture overview

```
                       ┌──────────────────────┐
   browser  ────►  Next.js frontend  ─────►   │  Axum backend (N instances)
                       │  rewrite /auth/* /api/* /ws /webhooks/*               │
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
                                                  RuleEvaluator                                            pg_notify('ws_broadcast')
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
        ├─► query Warp10 → write metric_samples → trigger dependent rules (Trigger::Poll)
        └─► query CC list_applications → on diff: set_state_if_changed → trigger dependent rules
```

The five lanes:

1. **Webhook ingestion.** Frontend rewrites `/webhooks/cc/{token}` to backend. The handler authenticates by token, wraps the body in a `BusMessage`, and produces it on the Pulsar topic `cc-webhooks` with `partition_key = cc_org_id`. Returns `204` in under 100 ms.
2. **Webhook consumer** (`backend/src/bus/consumer.rs`). Shared subscription so every backend instance load-balances. Parses, dedups via `webhook_dedup` (60 s window, cross-instance), maps the event to an `EventEffect` (Upsert / SetState / Delete), and on a real state transition calls `apply_state_change`, which writes history + broadcasts WS frame + invokes `rules::exec::trigger_for_monitor(state, user_id, monitor_id, Trigger::Webhook)`.
3. **Monitor poller** (`backend/src/monitors/poller.rs`). Runs in a Tokio interval task every 60 s on every backend instance. Per due monitor, takes a `pg_try_advisory_xact_lock(hash(id))` inside a transaction; only the lock-winner does the work. Two paths: `refresh_app_state` reads CC's `state` field and reconciles, `write_sample` writes a `metric_samples` row and broadcasts a `MetricsSnapshot` frame. Both call `trigger_for_monitor(state, user_id, monitor_id, Trigger::Poll)` so threshold conditions on cpu/mem evaluate every tick.
4. **Rule evaluator** (`backend/src/rules/`). See §9 below.
5. **WebSocket fan-out** (`backend/src/ws/`). One dedicated Postgres connection per instance runs `LISTEN ws_broadcast`. Producers (consumer, poller, rule actions) call `pg_notify('ws_broadcast', json)` instead of pushing to local `org_buses` directly — that way every instance sees every frame. The handler at `GET /ws?org=cc_org_id` upgrades and subscribes to its instance's `org_bus`.

## 6. Data model (Postgres)

16 tables. Migrations are append-only — never edit a shipped file.

| Table | Purpose |
| --- | --- |
| `users` | one row per CC user; carries AES-GCM-encrypted access token + secret + nonce |
| `orgs` | cached `(user_id, cc_org_id, name, avatar_url)` from `/v2/organisations` |
| `webhook_configs` | active myccmonitor webhooks per `(user_id, cc_org_id)`; `token` is 32 random bytes b64url |
| `webhook_dedup` | `(key, expires_at)`; cross-instance dedup, 60 s window, periodically purged |
| `monitors` | one row per cc_application / cc_addon / synthetic monitor; carries `current_state`, `last_poll_at`, `acknowledged`, `metadata` |
| `monitor_state_history` | append-only state changes; backs the `for X` time-based condition |
| `metric_samples` | `(monitor_id, ts) → cpu/mem/…` ; sliding 24-hour retention |
| `monitor_groups` | user groups with optional `auto_rules` JSONB |
| `monitor_group_members` | manual membership; effective members = manual ∪ auto-matched at read time |
| `rules` | one row per workflow rule; `condition` + `actions` are JSONB |
| `rule_versions` | last 5 snapshots per rule, auto-pruned |
| `rule_dependencies` | `(rule_id, ref_kind, ref_id)` extracted from condition tree at save; inverse-lookup index |
| `rule_firings` | audit log: `matched / not_matched / cooldown_skipped / error`; 30-day retention |
| `notification_channels` | `kind ∈ {email, slack, discord, webhook}`, `config` JSONB; `failure_count` + `last_*` fields |
| `alerts` | one row per `sendNotification` action; carries delivery outcome |
| sessions table | managed by `tower-sessions-sqlx-store` |
| `_myccmonitor_migrations` | applied-migration tracker for our custom runner |

See [CLAUDE.md §6](../CLAUDE.md#6-domain-model-postgres) for the full DDL.

## 7. OAuth 1.0a Clever Cloud flow

Lifted near-verbatim from `myccmetrics/backend-server/src/auth/oauth.rs`. Three legs:

1. `GET /auth/login` — `request_temporary_token()` → 303 to `https://api.clever-cloud.com/v2/oauth/authorize?oauth_token=…`. The request token *secret* is encrypted (AES-GCM) into a 5-min HTTP-only cookie `oauth_state`, so the callback works without any prior session state.
2. CC redirects to `GET /auth/callback?oauth_token=&oauth_verifier=…`.
3. `exchange_access_token()` → `(access_token, access_secret)`. The backend then signs `GET /v2/self`, upserts the `users` row with AES-256-GCM-encrypted `(token, secret)`, and sets a 7-day `tower-sessions` cookie pointing at that user_id.

The `users.oauth_nonce` column holds the two AES-GCM nonces concatenated: `token_nonce[12] || secret_nonce[12]`. Plaintext exists only in `auth::decrypt_user_oauth` while signing CC API calls.

**Consumer secret is NOT public.** myccmonitor needs its own OAuth consumer per environment, registered with the right callback URL. See `clever oauth-consumers create` example in §4. Rights minimum: `access-personal-information,access-organisations,manage-organisations-applications,manage-organisations-services`.

## 8. Webhook lifecycle

**Auto-create** (1-click from `/orgs`):

1. Backend generates a 32-byte token, b64url-encoded.
2. Backend lists existing CC webhooks via `GET /v2/notifications/webhooks/{ownerId}`, deletes any whose URL starts with `${PUBLIC_BASE_URL}/webhooks/cc/` (idempotent — re-clicking the button replaces the hook).
3. Backend calls signed `POST /v2/notifications/webhooks?ownerId=…` with `urls[].url` set to `${PUBLIC_BASE_URL}/webhooks/cc/{token}` and the event list (see [USER_GUIDE.md "Setting up webhooks"](./USER_GUIDE.md#setting-up-webhooks)).
4. Insert into `webhook_configs`.

**Receive** (any instance):

```
POST /webhooks/cc/:token
  → look up token in webhook_configs (404 if unknown)
  → wrap raw body in BusMessage { token, user_id, cc_org_id, raw_body, received_at }
  → produce on Pulsar topic cc-webhooks (partition_key = cc_org_id)
  → reply 204 (target latency <100 ms)
```

**Process** (Pulsar consumer, `Shared` subscription `myccmonitor-processor`):

```
1. Dedup: INSERT INTO webhook_dedup(key, expires_at) ... ON CONFLICT DO NOTHING.
   Conflict → drop.
2. Parse via WebhookEnvelope → routing → EventEffect.
3. For each effect:
   - Upsert/SetState → apply_state_change(state, user_id, monitor_id, ...)
     which writes history + broadcasts WS + calls trigger_for_monitor.
   - Delete → drop the monitor row.
4. Ack the Pulsar message. On panic/error, don't ack → Pulsar retries with backoff → DLQ after N attempts.
```

If the auto-create endpoint changes or fails, fall back to manual setup instructions in the UI (v1.1 contingency).

## 9. Workflow engine

Conceptually lifted from faxmon (`faxmon-backend/internal/services/rule_service_impl.go`), adapted to CC and improved with four fixes faxmon doesn't have: per-rule cooldown, time-based `for_duration` conditions, synthetic monitors, group-aware rules.

### Condition tree

```rust
enum Condition {
    Comparison {
        field: String,                    // "monitor:{uuid}:state" | "group:{uuid}:cpu" | …
        operator: CompOp,                 // Eq | Neq | Gt | Lt | Gte | Lte | Contains | NotContains
        value: serde_json::Value,
        for_duration: Option<Duration>,   // optional time-based qualifier
    },
    Logical { op: LogicalOp /* And | Or */, children: Vec<Condition> },
}
```

`monitor:{uuid}:state == critical for 5m` is true iff the most recent `monitor_state_history` row for that monitor shows `state=critical` and is at least 5 min old AND no transition has happened since. One SQL query per condition (`db::monitor_state_history::state_held_for`).

### Evaluator (`rules/evaluator.rs`)

Recursive walk with AND/OR short-circuit. For each comparison:
1. Parse the `field` string via `field::parse` → `FieldRef::Monitor` or `FieldRef::Group`.
2. Fetch the live value via `field::fetch` (DB-backed; falls back to `FieldValue::Null` on missing rows).
3. Compare against `value` with `compare()`.
4. If `for_duration` is set on `monitor:X:state`, additionally check `state_held_for`.

For metric `for_duration`, the qualifier is parsed but currently treated as instantaneous-only with a debug log (Phase 6.x follow-up).

### Actions (`rules/actions.rs`)

```rust
enum Action {
    SetMonitorState { target_monitor_id, state, message?, acknowledged? },
    SendNotification { channel_id, message /* handlebars */, subject? },
    Escalate { delay_seconds, target_rule_id },
}
```

Actions on a matching rule run in **parallel** via `tokio`. After `SetMonitorState`, the executor re-triggers any rule that watches the now-mutated monitor (`trigger_for_monitor_with_depth(..., chain_depth + 1)`).

### Cooldown

`rules.cooldown_seconds` (default 300, min 0). After a positive evaluation `last_fired_at` is updated. Subsequent positive evaluations within the cooldown window record outcome `cooldown_skipped`.

**Recovery-exempt:** if the `last_outcome_state` differs from the new verdict (e.g. previously `not_matched`, now `matched`), the cooldown is bypassed. This is implemented in `rules/exec.rs::execute_rule` lines 187-209.

### Anti-loop & cycle detection

- **Static** at save time: `rules/cycle.rs` builds a `petgraph::DiGraph` of `rules → monitors-they-write → rules-that-watch-those-monitors` (group refs expanded to effective members). `is_cyclic_directed` rejects the save with the cycle path returned to the UI.
- **Runtime** at exec time:
  - `MAX_CHAIN_DEPTH = 8`. Beyond that, `trigger_for_monitor_with_depth` aborts with an `error!` log.
  - `InFlight: DashSet<Uuid>` tracks monitors currently being mutated by a chain. A `SetMonitorState` whose target is already in flight is skipped with a `warn!` log.

### Versioning, validation, REST

- On every CREATE/UPDATE → snapshot to `rule_versions` with `version_id = v{unix_ts}`. Auto-prune to last 5.
- Save validates: name non-empty, ≥ 1 action, condition tree well-formed, every reference belongs to the same `user_id`, no static cycle.
- Endpoints (all under `/api/rules`):
  - `GET /api/rules`, `POST /api/rules`
  - `GET /api/rules/:id`, `PUT /api/rules/:id`, `DELETE /api/rules/:id`
  - `GET /api/rules/:id/firings` — recent audit rows
  - `GET /api/rules/:id/versions`, `POST /api/rules/:id/versions/:version_id/restore`
  - `POST /api/rules/:id/test` — dry-run; returns `{matched, actions_that_would_run}`
  - `GET /api/rules/:id/debug` — see §14

## 10. Notification dispatch

**Adapter trait** (`notifications/adapters.rs`):

```rust
#[async_trait]
trait NotificationAdapter {
    async fn send(&self, cfg: &Config, http: &Client, channel: &Channel, msg: &Rendered)
        -> anyhow::Result<()>;
}
```

Four implementations:

| Kind | Config shape |
| --- | --- |
| `email` | `{ to: [...], reply_to?, subject_prefix? }`, sends via `lettre::AsyncSmtpTransport` (STARTTLS, with-or-without creds) |
| `slack` | `{ webhook_url }` — POSTs `{ text }` |
| `discord` | `{ webhook_url }` — POSTs `{ content }` |
| `webhook` | `{ url, method?, headers? }` — POSTs/PUTs `{ subject, body }` |

**Templating** (`notifications/template.rs`): `OnceLock<Handlebars>` registry with three custom helpers:

- `{{since ts}}` — humanises an ISO timestamp into "5m ago".
- `{{relative_time ts}}` — same as `since` (alias).
- `{{format_state state}}` — uppercases the state.

Default templates fire when the user leaves the field blank (`"{{monitor.display_name}} is {{format_state monitor.current_state}} (rule: {{rule.name}})"`).

**Dispatcher** (`notifications/dispatch.rs`): on each `SendNotification` action, fetches the channel + the trigger's monitor, builds a JSON `NotifContext`, renders subject + body, runs the adapter with **3× exponential-backoff retry** (1 s → 4 s → 16 s). On success: `record_success` resets `failure_count`, inserts an `alerts` row, marks `notified_at = now()`. On final failure: `record_failure` increments + records the message, inserts an `alerts` row with `delivered: false`.

## 11. WebSocket + LISTEN/NOTIFY

**Why LISTEN/NOTIFY.** With multi-instance backends, an in-process `broadcast::Sender` only fans out within one instance. LISTEN/NOTIFY uses Postgres (already in the stack) to fan out cross-instance with sub-50 ms latency. The 8000-byte payload limit fits all our frame JSONs.

**Per-instance setup.** A dedicated Postgres connection runs `LISTEN ws_broadcast`. A Tokio task reads notifications, parses `{cc_org_id, frame}`, and pushes onto a local `org_buses: DashMap<String, broadcast::Sender<WsFrame>>`. Every producer (Pulsar consumer, MonitorPoller, rule actions) calls `pg_notify('ws_broadcast', payload)` instead of touching the local map — that way every instance receives every frame.

**Frame types** (`ws/frames.rs`, JSON tagged by `type`):

- `monitor_state { monitor_id, state, message, since }`
- `metrics_snapshot { monitor_id, cpu, mem, ts }`
- `webhook_health { cc_org_id, last_received_at }`
- `rule_firing { rule_id, rule_name, outcome, fired_at, trigger_kind, trigger_ref }`
- (Future: `group_state`, `alert`)

**Frontend.** `useOrgWebSocket(ccOrgId, onFrame)` opens `/ws?org=…`, exposes a `WsConnectionState` enum (`connecting | connected | reconnecting | offline`). Reconnects with exponential backoff (1 s → 30 s max). The sidebar `WebSocketIndicator` reads this state and displays a coloured pulse.

## 12. Multi-instance & advisory locks

**Polling** (`monitors/poller.rs`): each due monitor is wrapped in its own short transaction:

```rust
let mut tx = pool.begin().await?;
let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
    .bind(advisory_lock_key(monitor.id))
    .fetch_one(&mut *tx).await?;
if !acquired { tx.rollback().await?; continue; }
// ... do the work (state reconciliation, metric write, history insert, WS broadcast) ...
tx.commit().await?;       // releases the xact lock automatically
```

The `xact` variant is critical: session-scoped advisory locks acquired on one pool connection cannot be released on another (and sqlx may swap connections between `fetch_one` and `execute`). That cross-connection unlock attempt was the source of `you don't own a lock of type ExclusiveLock` NOTICEs in production — see CLAUDE.md §22 Phase 11b.

**Webhook dedup** is cross-instance (Postgres-backed `webhook_dedup`).

**Rule firing** is per-instance: whichever instance consumed the Pulsar message OR ran the poll cycle owns the rule evaluation and notification dispatch. The chain stays local; cross-instance broadcast happens only via `pg_notify` for the WS layer.

## 13. Deployment on Clever Cloud

**Apps**

- `myccmonitor-backend` — Rust runtime, scaled XS run / S build. Min 2 instances in prod.
- `myccmonitor-frontend` — Node.js runtime, `cd frontend && npm run build && npm start`.

Single-origin: the frontend rewrites `/auth/*`, `/api/*`, `/ws`, and `/webhooks/*` to the backend.

**Addons**

- Postgres — sessions + data + LISTEN/NOTIFY + advisory locks. Provides `POSTGRESQL_ADDON_URI`.
- Pulsar — provides `PULSAR_BINARY_URL`, `PULSAR_TOKEN`, `PULSAR_TENANT`, `PULSAR_NAMESPACE`. Two topics created at boot: `cc-webhooks` (30 d) and `rule-escalations` (1 d).

**Env vars**

| Var | Set where | Purpose |
| --- | --- | --- |
| `CC_CONSUMER_KEY` / `CC_CONSUMER_SECRET` | env | OAuth consumer for the env |
| `APP_ENCRYPTION_KEY` | env | 32-byte hex AES-256-GCM key |
| `POSTGRESQL_ADDON_URI` | addon | DB URL |
| `PULSAR_BINARY_URL` / `PULSAR_TOKEN` / `PULSAR_TENANT` / `PULSAR_NAMESPACE` | addon | Pulsar coordinates |
| `PUBLIC_BASE_URL` | env | OAuth callback + webhook URL base |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | env | Email adapter |
| `INSTANCE_ID` | CC | Instance-scoped Pulsar producer name |

**Deploy**

```bash
clever deploy --alias backend
clever deploy --alias frontend
```

Each deploy pushes the current `main` HEAD to the matching CC remote (`backend` and `frontend` are pre-configured git remotes). `clever activity --alias <name>` shows the last deploys with status; `clever logs --alias <name>` tails the running instance(s).

**Gotchas in the build pipeline** (also in [CLAUDE.md §18.b](../CLAUDE.md#18b-gotchas-surfaced-during-the-build-read-this-before-debugging)):

- `Cargo.lock` MUST be committed: CC runs `cargo build --release --locked` and fails fast if the lock is missing.
- `CC_RUN_COMMAND="cd frontend && npm run build && npm start"` is required because the CC Node runtime doesn't run `npm run build` on its own.
- `<name>.cleverapps.io` shortcut requires `clever domain add` after the first deploy.

## 14. Diagnostic endpoint & observability

`GET /api/rules/:id/debug` is a pure-read endpoint that returns a snapshot of the rule's current evaluation state. Powers the Debug button on `/rules/[id]` (see [USER_GUIDE.md "Debug"](./USER_GUIDE.md#debug)).

Response shape:

```rust
struct RuleDebugResponse {
    rule: Rule,
    would_match_now: bool,
    condition_summary: serde_json::Value,   // tree annotated per leaf with field/op/expected/actual/verdict
    cooldown: CooldownState {
        remaining_seconds: i64,
        cooldown_seconds: i64,
        last_fired_at: Option<DateTime<Utc>>,
        last_outcome_state: Option<String>,
        would_skip_due_to_cooldown: bool,
    },
    recent_firings: Vec<RuleFiring>,                         // last 10
    monitors_referenced: Vec<MonitorDebugInfo>,              // with held_for_seconds
    groups_referenced: Vec<GroupDebugInfo>,                  // with breakdown
    channels_used: Vec<ChannelDebugInfo>,                    // with failure_count + last_failure_message
}
```

Implementation in `backend/src/rules/debug.rs` reuses `evaluator::evaluate`, `dependencies::extract`, `field::parse/fetch`, `groups::compute_view`, and `rule_firings::list_recent_for_rule`.

**INFO-level tracing** is in place on the rule eval hot path:

- `bus/consumer.rs::apply_state_change` — logs the state transition + the dependent-rule count returned by `trigger_for_monitor`.
- `rules/exec.rs::trigger_for_monitor_with_depth` — logs entry (monitor_id, user_id, chain_depth, direct + group rule counts) and per-rule outcome.
- `rules/exec.rs::execute_rule` — logs entry, condition verdict, cooldown decision, action results.
- `notifications/dispatch.rs::dispatch` — logs channel resolution + per-attempt result + final delivered/failed.

With the default `RUST_LOG=info,sqlx=warn`, every state transition produces a readable trace in `clever logs --alias backend`.

## 15. Phase log pointer

The chronological record of how the codebase was built — which phase shipped what, what bugs we hit, what we lifted from sibling projects — lives in [CLAUDE.md §22 "Implementation log"](../CLAUDE.md#22-implementation-log). Read it when you want to understand *why* a particular design decision was made.

## 16. Testing & verification

**Backend**

```bash
cargo build --release                    # 50-60 s on M1, ~3-4 min on CC
cargo clippy --all-targets -- -D warnings
sqlx migrate add <name>                  # then put SQL in migrations/NNNNNN_<name>.sql
cargo sqlx prepare                       # offline metadata for CI
```

**Frontend**

```bash
npm run lint                             # eslint
npm run build                            # next build (Turbopack)
npm run dev                              # http://localhost:3000
```

**Smoke tests** (local docker-compose running):

```bash
# Backend health
curl http://localhost:8080/health

# Fake a webhook (replace TOKEN with a value from webhook_configs)
curl -i -X POST http://localhost:8080/webhooks/cc/${TOKEN} \
  -H 'Content-Type: application/json' \
  -d '{"event":"DEPLOYMENT_FAIL","data":{"id":"app_xxx","ownerId":"orga_xxx"}}'

# Tail the consumer logs to see the trace flow
RUST_LOG=info,myccmonitor_backend=debug cargo run

# Pulsar topic introspection (against the addon)
pulsar-admin topics stats persistent://${PULSAR_TENANT}/${PULSAR_NAMESPACE}/cc-webhooks
pulsar-admin topics peek-messages -n 5 -s myccmonitor-processor persistent://.../cc-webhooks

# Postgres
psql $POSTGRESQL_ADDON_URI
\dt
SELECT id, name, last_fired_at, cooldown_seconds FROM rules;
SELECT * FROM rule_firings ORDER BY fired_at DESC LIMIT 20;
SELECT pid, query FROM pg_stat_activity WHERE query LIKE '%LISTEN%';
```

**Integration testing.** Most of the stack is exercised end-to-end by running the full docker-compose + a CC dev OAuth consumer + a real CC org. Unit tests live next to the code they test (`#[cfg(test)] mod tests`); coverage is currently sparse and is expected to grow with each new feature.

---

## Conventions

**Backend (Rust)**

- `anyhow::Result` at boundaries, `thiserror` only when an error is part of an API contract.
- `tracing` with structured fields (`user_id`, `org_id`, `monitor_id`, `rule_id`). No `println!`. No `unwrap()` outside tests and `main.rs` boot.
- Comments only for non-obvious *why*, not *what*. Module layout: each domain (auth, webhooks, monitors, groups, rules, notifications, …) is a sibling under `src/`. No `utils`.
- Migrations are append-only; never edit a shipped file.
- Workflow engine code paths reference `rule_id` in every `tracing` event for traceability.

**Frontend (Next.js)**

- Server components by default. `"use client"` only when needed (event handlers, hooks, browser APIs).
- API calls go through `services/api.ts`. No scattered `fetch`.
- Stores (Zustand) are domain-specific. Persist sparingly.
- Tailwind first; hand-rolled primitives second; custom CSS last resort.
- `RuleEditor` is a client-only component, mounted lazily under `/rules/new` and `/rules/[id]`.

**Both**

- Every tenant-scoped query/handler MUST filter by `user_id`. Reviewer veto right.
- No backwards-compatibility shims — delete unused code instead of marking it deprecated.
- Read [CLAUDE.md](../CLAUDE.md) before contributing. Update it (the §22 phase log + relevant body sections) in the same commit as the change.
