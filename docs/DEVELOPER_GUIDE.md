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

**Frontend** — Next.js **16** (app router; **breaking changes from Next 15** — read `frontend/AGENTS.md` and `frontend/node_modules/next/dist/docs/` before writing Next-specific code), TypeScript 5, React 19.2, Zustand 5, **Tailwind CSS v4** (CSS-only theme via `@theme` in `frontend/src/app/globals.css`), hand-rolled UI primitives (no shadcn), `@phosphor-icons/react`, `sonner`, ReactFlow 11 + Dagre. The visual system is **Forge Mécanique** — a locked dark industrial palette (burnt leather, copper, riveted steel, glowing LEDs); the previous warm-pastel light/dark theme pair has been retired. See §18 below.

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
│       │   ├── page.tsx            Workshop entrance (public landing)
│       │   ├── layout.tsx          Geist Mono + Inter Tight + Instrument Serif fonts; dark-only
│       │   ├── globals.css         Forge tokens (--forge-*, --led-*, --copper-glow), animations
│       │   └── (app)/              authenticated routes share AppShell
│       │       ├── layout.tsx      AppShell + Toaster
│       │       ├── orgs/, orgs/[ccOrgId]/      Workshops list, Control Room
│       │       ├── groups/, groups/[id]/       Production Lines list, detail
│       │       ├── rules/, rules/new/, rules/[id]/  Blueprint Library + editor
│       │       └── channels/                   Relay tower
│       ├── components/
│       │   ├── ui/                 generic primitives (Button, Card, Dialog, Skeleton, …)
│       │   ├── forge/              Forge primitives (see §18): LedIndicator,
│       │   │                       MachineCard, MachineUnit, MachineGauge, Sector,
│       │   │                       WSPill, RiveterButton, Antenna, SignalBars,
│       │   │                       RolledStateReactor, Conveyor, BlueprintCard
│       │   ├── layout/             AppShell, ControlPanel, ControlPanelLink, PageHeader
│       │   └── RuleEditor/         ReactFlow canvas + Nodes/* + DebugPanel (legacy nodes;
│       │                           Forge re-skin pending — see §18 deferred work at the end)
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
        ├─► query Warp10 → write metric_readings (one row per metric, prune to last 10) → trigger dependent rules (Trigger::Poll)
        └─► query CC list_applications → on diff: set_state_if_changed → trigger dependent rules
```

The five lanes:

1. **Webhook ingestion.** Frontend rewrites `/webhooks/cc/{token}` to backend. The handler authenticates by token, wraps the body in a `BusMessage`, and produces it on the Pulsar topic `cc-webhooks` with `partition_key = cc_org_id`. Returns `204` in under 100 ms.
2. **Webhook consumer** (`backend/src/bus/consumer.rs`). Shared subscription so every backend instance load-balances. Parses, dedups via `webhook_dedup` (60 s window, cross-instance), maps the event to an `EventEffect` (Upsert / SetState / Delete), and on a real state transition calls `apply_state_change`, which writes history + broadcasts WS frame + invokes `rules::exec::trigger_for_monitor(state, user_id, monitor_id, Trigger::Webhook)`.
3. **Monitor poller** (`backend/src/monitors/poller.rs`). Runs in a Tokio interval task every 60 s on every backend instance. Per due monitor, takes a `pg_try_advisory_xact_lock(hash(id))` inside a transaction; only the lock-winner does the work. Two paths: `refresh_app_state` reads CC's `state` field and reconciles, `write_sample` fetches metrics from Warp10 (chunked at `WARP10_BATCH_SIZE = 3` ids per script with `mapper.rate` per-instance for net counters), writes one row per non-null metric to `metric_readings` (auto-pruning to `KEEP_N_PER_METRIC = 10` rows per `(monitor, metric)` on each insert), reads back `latest_per_metric` to assemble the WS frame, and broadcasts a `MetricsSnapshot`. The frame carries the **last known value per metric** independently — disk's slow ~5 min cadence doesn't make the bar flicker between values and `n/a`. Both paths call `trigger_for_monitor(state, user_id, monitor_id, Trigger::Poll)`; the poll trigger is gated on `fresh_metric` (= this poll produced new data) so threshold rules don't fire repeatedly on stale carried-forward values.
4. **Rule evaluator** (`backend/src/rules/`). See §10 below. The Pulsar event bus that feeds it is documented in §9.
5. **WebSocket fan-out** (`backend/src/ws/`). One dedicated Postgres connection per instance runs `LISTEN ws_broadcast`. Producers (consumer, poller, rule actions) call `pg_notify('ws_broadcast', json)` instead of pushing to local `org_buses` directly — that way every instance sees every frame. The handler at `GET /ws?org=cc_org_id` upgrades and subscribes to its instance's `org_bus`.

## 6. Data model (Postgres)

16 tables. Migrations are append-only — never edit a shipped file.

| Table | Purpose |
| --- | --- |
| `users` | one row per CC user; carries AES-GCM-encrypted access token + secret + nonce |
| `orgs` | cached `(user_id, cc_org_id, name, avatar_url)` from `/v2/organisations` |
| `webhook_configs` | active myccmonitor webhooks per `(user_id, cc_org_id)`; `token` is 32 random bytes b64url |
| `webhook_dedup` | `(key, expires_at)`; cross-instance dedup, 60 s window, periodically purged |
| `monitors` | one row per cc_application / cc_addon / synthetic monitor; carries `current_state`, `last_poll_at`, `acknowledged`, `metadata`, `cc_resource_id` (CC API id) and `cc_metrics_id` (Warp10 lookup key — `realId` for addons, `cc_resource_id` for apps) |
| `monitor_state_history` | append-only state changes; backs the `for X` time-based condition |
| `metric_readings` | `(monitor_id, metric_name, ts) → value`; pruned to `KEEP_N_PER_METRIC = 10` rows per (monitor, metric) on every insert. One row per Warp10 reading, no NULL placeholders. CC's per-metric cadence differences (`disk.used_percent` ~5 min vs `cpu.usage_user` ~1 min) are handled natively |
| `metric_samples` | **legacy** — wide-row table from Phase 4 / 11e; no longer written since Phase 11f. Kept around as a backfill source / rollback safety; will be dropped in a future migration |
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

## 9. Pulsar event bus — why and how

This is the section to read before touching anything in `backend/src/bus/`. It explains why we picked Apache Pulsar over the obvious alternatives, exactly how the two topics are wired, and the operational gotchas that bit us during Phase 2.

### Why Pulsar (and not X)

The webhook ingress path has four hard requirements that, taken together, exclude every cheaper option:

1. **Zero data loss across backend restarts.** A Clever Cloud `DEPLOYMENT_FAIL` event arriving while a backend pod is being redeployed must reach the rule evaluator. We can never lose a state transition.
2. **Multi-instance, work-stealing fan-out.** The backend runs ≥ 2 instances in prod. Each webhook must be processed exactly once across the fleet, with automatic load balancing on every redeploy.
3. **A 30-day audit / replay window.** Operators need to ask "what events arrived for org X between T₁ and T₂?" without keeping a parallel audit table in Postgres.
4. **Native delayed delivery for `Action::Escalate { delay_seconds }`.** Escalations have to survive backend restarts — a Tokio `sleep` in-process loses the timer if the process dies. Some external scheduler must hold the message until the deadline.

Cheaper options checked and rejected:

- **In-memory `tokio::sync::broadcast`.** Fails (1), (2), (3), and (4). Restart kills the queue, no cross-instance fan-out, no retention, no scheduling.
- **Postgres-only (LISTEN/NOTIFY + a queue table).** `pg_notify` is **not durable** (subscribers miss messages they didn't `LISTEN` for), so we'd need a queue table polled by every instance. That's doable but brings: a queue-as-a-table workload that competes with the application's writes; no native delayed delivery (we'd reinvent it with `cron` or a "ready_at" column); and the audit log still sits in Postgres bloating the OLTP database. We do still use `LISTEN/NOTIFY` — but only for the WebSocket fan-out (small ephemeral payloads, fine to lose).
- **Redis Streams.** Adds a service we don't otherwise need. No native delayed delivery (you'd hand-roll `ZADD … score=deadline` + a poller). Smaller community than Pulsar / Kafka for durable messaging at our scale.
- **Apache Kafka.** Same durability story as Pulsar, but heavier ops, no native per-message scheduling (you'd use Kafka Streams + a state store, or a separate scheduler), and Clever Cloud doesn't expose a managed Kafka — adopting it would mean leaving the addon ecosystem.
- **AWS SQS / Google Pub/Sub.** Vendor lock-in to a different cloud. We already deploy on Clever Cloud and Pulsar is a first-party CC addon ("MateriaMQ" — the Clever Cloud Pulsar product).

Pulsar wins on every requirement at once: durable storage with configurable retention, `Shared` subscriptions = native work-stealing across instances, `deliver_at_time` on each message = native scheduled delivery (broker holds the message until the wall-clock target), and it's a supported CC addon so we get TLS endpoint + JWT auth + tenant/namespace provisioning out of the box.

### Topic layout

Two topics live under `persistent://${PULSAR_TENANT}/${PULSAR_NAMESPACE}/`:

| Topic | Retention | Producer | Consumer subscription | Purpose |
| --- | --- | --- | --- | --- |
| `cc-webhooks` | **30 days** | `WebhookProducer` (one per backend instance) | `myccmonitor-processor` (Shared) | Inbox for every CC webhook + 30-day audit / replay window |
| `rule-escalations` | **1 day** | `EscalationProducer` (one per instance) | `myccmonitor-escalator` (Shared) | Delayed-delivery messages produced by `Action::Escalate` |

Both topics are auto-created at boot via `bus::ensure_topic_exists`. Idempotent — re-running on an existing topic is a no-op. The 30-day retention on `cc-webhooks` doubles the topic as our audit log: `pulsar-admin topics peek-messages` and the `Reader` API let us replay any window without a parallel Postgres table. Retention is set on the namespace policy, not per-message.

### Producer naming — the `ProducerBusy` trap

Every producer gets a unique name per instance:
```
myccmonitor-{role}-{INSTANCE_ID}-{uuid_v4}
```
where `INSTANCE_ID` is injected by Clever Cloud and the UUID changes on every cold start.

Why: Pulsar treats producer names as a uniqueness key. If a backend pod dies without releasing its connection, the broker may reject a new producer with the **same** name as `ProducerBusy` until the broker times the dead session out (~minutes). Suffixing a fresh UUID on every boot side-steps the issue entirely — see `bus/escalations.rs:46-49` and `bus/producer.rs` for the same pattern. Phase 0 had a fixed name and tripped over this in CI; the lesson is encoded in CLAUDE.md §18.b.

### Webhook ingress flow (`cc-webhooks`)

```
POST /webhooks/cc/:token                                  (any backend instance)
  └─ verify token via webhook_configs                     (404 on miss)
  └─ wrap raw body in BusMessage { token, user_id,
       cc_org_id, raw_body, received_at }
  └─ produce on Pulsar topic cc-webhooks
       partition_key = cc_org_id                          (preserves per-org ordering)
  └─ reply 204 (target latency <100 ms)

[Pulsar broker holds the message in storage; Shared subscription
 dispatches to whichever consumer is least loaded across the fleet.]

Consumer (one per instance, Shared sub `myccmonitor-processor`)
  └─ webhook_dedup INSERT … ON CONFLICT DO NOTHING        (60 s window, cross-instance via Postgres UNIQUE)
       └─ conflict → ack & drop                           (duplicate from Pulsar redelivery)
  └─ parse via WebhookEnvelope → EventEffect              (see bus/consumer.rs::map_event)
  └─ apply (Upsert / SetState / Delete):
       ├─ monitors::upsert_cc / set_state_if_changed / delete
       ├─ monitor_state_history INSERT                    (state-transition audit)
       ├─ pg_notify('ws_broadcast', json)                 (fans out the WS frame to every instance)
       └─ rules::exec::trigger_for_monitor(Trigger::Webhook)
  └─ ack on success                                       (Pulsar advances the cursor)
  └─ on panic / Err: don't ack → Pulsar redelivers with
     exponential backoff → DLQ topic after N attempts     (broker default policy)
```

`partition_key = cc_org_id` matters: Pulsar guarantees ordering **within a partition**. Anchoring all events for one CC org to the same partition means the deploy-success that ought to follow a deploy-fail can't be reordered behind it.

The `webhook_dedup` table (Postgres) is the cross-instance dedup primitive — it does the work that exactly-once delivery (which Pulsar does not promise) leaves on the table. Pulsar guarantees at-least-once; the `INSERT … ON CONFLICT DO NOTHING` collapses duplicates within a 60-second window.

### Escalations flow (`rule-escalations`)

The escalator topic uses a single Pulsar primitive that does most of the heavy lifting: `producer::Message::deliver_at_time = now_ms + delay_ms`. The broker simply holds the message until the wall-clock target. Code in `bus/escalations.rs::EscalationProducer::schedule`:

```
Action::Escalate { delay_seconds, target_rule_id }
  └─ EscalationMessage { user_id, rule_id: target_rule_id,
                         from_rule_id, scheduled_at_ms,
                         scheduled_for_ms = now + delay*1000 }
  └─ producer.send(payload, deliver_at_time = scheduled_for_ms)

[Broker holds the message until scheduled_for_ms.]

EscalationConsumer (Shared sub `myccmonitor-escalator`, every instance)
  └─ deserialize EscalationMessage
  └─ db::rules::find(rule_id) for the user
  └─ rules::exec::execute_rule(state, rule, Trigger::Escalation { from_rule_id })
  └─ ack
```

Crucially this means escalation timers **survive backend restarts** (the broker is the source of truth for "when") and can be picked up by **any** instance (whichever subscriber is connected when the message comes due). No leader election, no in-process timers, no cron table to maintain.

### Replay & audit

Because `cc-webhooks` retains 30 days of messages, an operator can introspect any incident after the fact:

```bash
# Count + size + backlog for the topic
pulsar-admin topics stats persistent://${PULSAR_TENANT}/${PULSAR_NAMESPACE}/cc-webhooks

# Peek the last N messages on the processor subscription
pulsar-admin topics peek-messages -n 20 -s myccmonitor-processor \
    persistent://${PULSAR_TENANT}/${PULSAR_NAMESPACE}/cc-webhooks

# Programmatic replay from a timestamp (read-only — does NOT re-trigger processing)
# Roadmap: a thin admin HTTP endpoint that wraps a Pulsar Reader from a given
# `MessageId::Earliest` or a millisecond timestamp.
```

The replay is intentionally **read-only**; calling `Reader` does not move the consumer cursor on `myccmonitor-processor`, so it never re-fires rules or notifications. If you ever need to *replay-and-execute*, that's a separate consumer with its own subscription name.

### Operational gotchas

- **`protoc` is a hard build dependency.** The `pulsar` 6.x crate (`pulsar-rs`) generates protobuf bindings at compile time. macOS dev: `brew install protobuf`. Clever Cloud build container: already provided. CI: needs the apt package. Without it `cargo build` fails fast — see CLAUDE.md §2 quick start.
- **Env priority for the broker URL.** Both `PULSAR_BINARY_URL` and `ADDON_PULSAR_BINARY_URL` are read in that order. The first wins. In dev with the Docker standalone you must point `PULSAR_BINARY_URL` at `pulsar://localhost:6650` *and* keep `PULSAR_TOKEN` empty — the no-auth code path in `bus::connect` skips the JWT block when the token is blank. On CC the addon injects all four `PULSAR_*` vars and TLS is mandatory (`pulsar+ssl://…:6651`).
- **Subscription type must be `Shared` for both topics.** `Exclusive` would let a single consumer monopolise the topic — rest of the fleet would idle. `Failover` would partition by hash and cap throughput at one-consumer-per-partition. `Shared` does the right thing: the broker round-robins messages across active consumers.
- **Partitioned vs non-partitioned topics.** We use **non-partitioned** topics today (sufficient for current volume). The flow above with `partition_key = cc_org_id` still works — Pulsar threads `partition_key` into ordering hints even on a non-partitioned topic. Switching to partitioned later (`pulsar-admin topics create-partitioned-topic …`) keeps the ordering guarantee per partition without code changes.
- **DLQ.** Failed-then-retried messages eventually land in `<topic>-DLQ` per the broker's default redelivery policy. We don't have a UI for it yet (CLAUDE.md §21 future work). For now, `pulsar-admin topics list` exposes the DLQ topic and `peek-messages` works as expected.
- **`webhook_dedup` is Postgres-side, not Pulsar-side.** Pulsar offers idempotent producers, but the dedup we actually care about is "two backend instances both picked up the same message via at-least-once delivery". That is a *consumer-side* problem and Postgres does the job better than fiddling with broker config.

### File map

```
backend/src/bus/
├── mod.rs              connect(cfg) → Pulsar<TokioExecutor>; ensure_topic_exists
├── message.rs          BusMessage envelope + serde
├── producer.rs         WebhookProducer::build / publish for cc-webhooks
├── consumer.rs         Shared-sub consumer for cc-webhooks; map_event; apply_state_change
└── escalations.rs      EscalationProducer (deliver_at_time) + run_consumer for rule-escalations
```

Background tasks are spawned in `main.rs` after the producer/consumer build steps; both consumers run forever inside their own `tokio::spawn` and are torn down by process shutdown.

## 10. Workflow engine

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
  - `GET /api/rules/:id/debug` — see §15

## 11. Notification dispatch

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

## 12. WebSocket + LISTEN/NOTIFY

**Why LISTEN/NOTIFY.** With multi-instance backends, an in-process `broadcast::Sender` only fans out within one instance. LISTEN/NOTIFY uses Postgres (already in the stack) to fan out cross-instance with sub-50 ms latency. The 8000-byte payload limit fits all our frame JSONs.

**Per-instance setup.** A dedicated Postgres connection runs `LISTEN ws_broadcast`. A Tokio task reads notifications, parses `{cc_org_id, frame}`, and pushes onto a local `org_buses: DashMap<String, broadcast::Sender<WsFrame>>`. Every producer (Pulsar consumer, MonitorPoller, rule actions) calls `pg_notify('ws_broadcast', payload)` instead of touching the local map — that way every instance receives every frame.

**Frame types** (`ws/frames.rs`, JSON tagged by `type`):

- `monitor_state { monitor_id, state, message, since }`
- `metrics_snapshot { monitor_id, cpu, mem, ts }`
- `webhook_health { cc_org_id, last_received_at }`
- `rule_firing { rule_id, rule_name, outcome, fired_at, trigger_kind, trigger_ref }`
- (Future: `group_state`, `alert`)

**Frontend.** `useOrgWebSocket(ccOrgId, onFrame)` opens `/ws?org=…`, exposes a `WsConnectionState` enum (`connecting | connected | reconnecting | offline`). Reconnects with exponential backoff (1 s → 30 s max). The sidebar `WebSocketIndicator` reads this state and displays a coloured pulse.

## 13. Multi-instance & advisory locks

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

## 14. Deployment on Clever Cloud

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
clever deploy --alias myccmonitor-backend     # only when backend/ changed
clever deploy --alias myccmonitor-frontend    # only when frontend/ changed
```

Each deploy pushes the current branch's HEAD to the matching CC remote (`myccmonitor-backend` and `myccmonitor-frontend` are pre-configured git remotes — see `.clever.json` in the repo root). `clever activity --alias <name>` shows the last deploys with status; `clever logs --alias <name>` tails the running instance(s). The frontend re-skin in late 2026 was a frontend-only change — backend stayed pinned to the prior `main`, only the frontend redeployed.

**Gotchas in the build pipeline** (also in [CLAUDE.md §18.b](../CLAUDE.md#18b-gotchas-surfaced-during-the-build-read-this-before-debugging)):

- `Cargo.lock` MUST be committed: CC runs `cargo build --release --locked` and fails fast if the lock is missing.
- `CC_RUN_COMMAND="cd frontend && npm run build && npm start"` is required because the CC Node runtime doesn't run `npm run build` on its own.
- `<name>.cleverapps.io` shortcut requires `clever domain add` after the first deploy.

## 15. Diagnostic endpoints & observability

Two read-only debug endpoints help answer "why isn't this working?" questions without leaving the dashboard.

### Rule debug — `GET /api/rules/:id/debug`

A snapshot of the rule's current evaluation state. Powers the Debug button on `/rules/[id]` (see [USER_GUIDE.md "Debug"](./USER_GUIDE.md#debug)).

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

### Monitor debug — `GET /api/orgs/:cc_org_id/monitors/:monitor_id/debug`

Answers "**why is disk/net empty for this app?**" definitively, in pure SQL (<50 ms response). Multi-tenant guarded: org ownership + monitor.user_id + cc_org_id match all enforced.

Response shape:

```rust
struct MonitorDebugResponse {
    monitor: Monitor,
    cc_metrics_id: Option<String>,           // Warp10 lookup key
    samples_count_30m: i64,                  // total readings in the last 30 min
    window: &'static str,                    // "30m"
    available_metrics: Vec<&'static str>,    // metrics with ≥1 reading in the window
    missing_metrics: Vec<&'static str>,      // expected ∖ available
    expected_metrics: &'static [&'static str], // ["cpu","mem","disk","net_in","net_out"]
    latest_sample: Option<MetricSnapshotApi>, // assembled from latest_per_metric
    last_poll_at: Option<DateTime<Utc>>,
    note: Option<&'static str>,              // "no samples yet" / "synthetic monitor"
}
```

Implementation in `backend/src/handlers/api.rs::monitor_debug` reuses `monitors::find_by_id_for_user`, `metric_readings::availability` and `metric_readings::latest_per_metric`. The frontend's `MonitorDebugDialog` (Bug button on `MonitorCard`) renders chips for each expected metric (green = present, red = missing) plus the latest_sample row — see [USER_GUIDE.md "Monitor diagnostic"](./USER_GUIDE.md#monitor-diagnostic).

**Earlier iterations tried Warp10 `FIND` for live class enumeration** (FIND is the WarpScript op for "list GTS metadata matching this regex"). Three failed attempts: wrong signature → 500, wide regex → minutes-long hang + 500 from upstream proxy, narrow regex → still 500 after 10 s. Conclusion: FIND on CC's Warp10 isn't reliable enough for a user-facing endpoint. Pivoted to reading `metric_readings` itself, which is the authoritative answer — if the poller didn't capture the metric in 30 min, CC isn't emitting it for this app's runtime. No Warp10 round-trip in the debug path.

**INFO-level tracing** is in place on the rule eval hot path:

- `bus/consumer.rs::apply_state_change` — logs the state transition + the dependent-rule count returned by `trigger_for_monitor`.
- `rules/exec.rs::trigger_for_monitor_with_depth` — logs entry (monitor_id, user_id, chain_depth, direct + group rule counts) and per-rule outcome.
- `rules/exec.rs::execute_rule` — logs entry, condition verdict, cooldown decision, action results.
- `notifications/dispatch.rs::dispatch` — logs channel resolution + per-attempt result + final delivered/failed.

With the default `RUST_LOG=info,sqlx=warn`, every state transition produces a readable trace in `clever logs --alias backend`.

## 16. Phase log pointer

The chronological record of how the codebase was built — which phase shipped what, what bugs we hit, what we lifted from sibling projects — lives in [CLAUDE.md §22 "Implementation log"](../CLAUDE.md#22-implementation-log). Read it when you want to understand *why* a particular design decision was made.

## 17. Testing & verification

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

## 18. Forge Mécanique design system

The frontend is built around an industrial metaphor: monitored apps are "machines" on the floor, groups are "production lines" with reactors and conveyors, channels are "transmitters" in a "relay tower", rules are "blueprints" in a "library". The vocabulary is purely UI; the underlying types and APIs keep the technical names (monitor, group, rule, channel).

**Tokens** (`frontend/src/app/globals.css`). All Forge-native CSS custom properties live on `:root` — no `.dark` selector, no `prefers-color-scheme` switch. The legacy warm tokens (`--color-bg`, `--color-text`, …) are aliased to Forge values so any unmigrated component still renders coherently:

| Token | Use |
| --- | --- |
| `--forge-floor`, `--forge-floor-alt`, `--forge-floor-deep` | App background base + 45° hatch alternation + deepest sink |
| `--forge-machine-top` / `-bottom`, `--forge-machine-action-*`, `--forge-machine-logic-*` | Machine body gradients (default / destructive / logic gate) |
| `--forge-rim`, `--forge-rim-bright`, `--forge-rim-dim` | Riveted-metal borders |
| `--forge-text`, `--forge-text-accent`, `--forge-text-muted`, `--forge-text-dim` | Text scale (cream / cuivre clair / cuivre / dim copper) |
| `--copper-glow`, `--copper-glow-strong`, `--copper-glow-soft` | Pipe flow, focus rings, accent highlights |
| `--led-ok`, `--led-warn`, `--led-crit`, `--led-dim` | Severity-coded LED colours |

`--shadow-rivet` (and `--shadow-rivet-bright`) is the canonical raised-surface shadow — inset highlight + outset drop shadow, applied via the `surface-rivet` utility class.

**Animations** (CSS-only, all gated by `prefers-reduced-motion`):
- `led-pulse-warn` (1.5 s) and `led-pulse-crit` (0.5 s) — used by `LedIndicator`.
- `forge-spark` — copper glow pulse on a card when a fresh WebSocket frame lands.
- `pipe-flow` — `stroke-dasharray` defile on a parallel line for the rule editor's pipe edges (planned).
- `conveyor-slide` — translateX gradient loop for `Conveyor` segments on the production-line page.
- `forge-shimmer` — copper-tinted skeleton shimmer.

**Backgrounds**:
- `bg-forge-hatch` — repeating 45° leather hatch (used on the body).
- `bg-forge-blueprint` — radial-dot 22 × 22 grid (used on the assembly area + ReactFlow canvas).
- `bg-forge-panel`, `bg-forge-machine`, `bg-forge-machine-action`, `bg-forge-machine-logic` — surface gradients.

**Typography**:
- **Sans** Inter Tight (body, UI).
- **Display** Instrument Serif (page titles, machine names — gives a hand-engraved feel against metal). Italic variant used for the "Control Room" / "Production line" / "Relay tower" / "Blueprint library" subtitles.
- **Mono** Geist Mono (gauge readouts, IDs, formulas, footers).

**Forge primitives** (`frontend/src/components/forge/`):

| Component | Purpose |
| --- | --- |
| `LedIndicator` | Severity-driven animated LED dot. Sizes xs/sm/md/lg. Pulses at 1.5 s for warn, 0.5 s for crit, static otherwise. |
| `MachineCard` (+ `MachineLabel`) | Riveted-metal surface primitive. Variants: `default`, `action` (red-rim destructive), `logic` (cooler tone for AND/OR gates). Used by every form, every machine-style row. |
| `MachineUnit` | The dashboard's monitor card. Wraps a `MachineCard` with LED head + serif name + kind tag + 3 `MachineGauge`s + NET line + "Bug" diagnostic trigger. Sparks on fresh frames. |
| `MachineGauge` | Forge-skinned bar with copper-to-red gradient by severity. Supports `loading` / `na` / `data` / `no-data` states (drives the n/a-vs-shimmer logic in the dashboard). |
| `Sector` | Section heading with copper-fade horizontal divider + count chip; used to title sectors of the Control Room and any other grid. |
| `WSPill` | Inline pill that shows the WebSocket bus state (Bus live / Connecting / Reconnecting / Bus offline) with a severity-mapped LED. Replaces the legacy `WebSocketIndicator`. Reads from sessionStorage when no `state` prop is passed (lets per-org pages broadcast their state up to the shell). |
| `RiveterButton` | Brass-plate styled button with `default` / `primary` / `danger` / `ghost` variants and `sm/md/lg` sizes. Replaces the legacy `Button` for Forge surfaces. |
| `Antenna` | Copper-bordered icon plate for channel kinds (Slack / Email / Discord / generic). |
| `SignalBars` | 5-bar signal indicator that maps `failure_count` + recent-success state to colour and strength. |
| `RolledStateReactor` | Big circular reactor showing a group's rolled-up state with severity-driven pulse and a dashed inner halo. Used as the centrepiece on `/groups/[id]`. |
| `Conveyor` | Animated belt segment (`bg-image` translateX-loop at 1 s). Place between two stations on the assembly line. |
| `BlueprintCard` | Folded paper-on-metal card with corner crease and a faint copper graph-paper grid, used by the Blueprint Library row list. |

**Common chrome**:
- The control-panel sidebar (`components/layout/ControlPanel.tsx`) carries a riveted dotted strip on its right edge, the factory brand at the top, panel-link styling with a copper accent border on the active item, and the `WSPill` in its "Bus" section.
- Page headers (`components/layout/PageHeader.tsx`) keep the same component shape as before, with the title rendered in Instrument Serif italic + copper accent for the page-archetype label ("Control Room", "Production line", "Blueprint library", …).

**Migration note.** The rule editor (`/rules/new`, `/rules/[id]`) is the deepest re-skin and stayed in legacy form during the late-2026 redesign — see [the saved plan](../../.claude/plans/faisons-un-petit-brainstorming-golden-balloon.md) for the planned Forge Floor (4 ReactFlow node types rebuilt as Sensor / LogicGate / Actuator / RuleOutput, `PipeEdge` with flow animation, `PaletteSidebar`, right `Inspector`, `Combobox`, `DurationPicker`, `LiveReadout`, `InlineErrorChip`, drag-from-palette, `graphToRule` returning `Result`, client-side leaf evaluator). That work is queued; the chrome around the editor (toolbar, page header, save/dry-run/debug buttons) is already Forge-aware.

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
