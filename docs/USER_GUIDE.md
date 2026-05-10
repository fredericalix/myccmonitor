# myccmonitor — User Guide

A walkthrough of the deployed app at <https://myccmonitor-frontend.cleverapps.io>. This guide is for anyone who supervises Clever Cloud applications and add-ons through myccmonitor — no Rust or TypeScript knowledge required. For the engineering side, see [`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md).

---

## What myccmonitor does

myccmonitor watches your Clever Cloud applications and add-ons and tells you when something is wrong — a deploy fails, an app stops, CPU stays pegged, an add-on goes down, or any composite condition you've defined. It listens to Clever Cloud webhooks for instant notifications and polls Warp10 every minute for metrics, then runs your **workflow rules** to decide whether to set monitor states, send notifications, or escalate.

The app is multi-tenant: signing in with your Clever Cloud account creates an isolated workspace. Each user only ever sees their own organisations, monitors, groups, rules, and channels.

## The Forge Mécanique aesthetic

myccmonitor wears an industrial design language: a dark "atelier" canvas, riveted steel surfaces, copper trim, and glowing LEDs whose pulse rate maps to severity. Each domain object has a metaphor:

- A monitored app or add-on is a **machine** on the floor.
- A group of monitors is a **production line**, with a central reactor and an animated conveyor.
- A notification channel is a **transmitter** in the **relay tower**, with antennae and signal-strength bars.
- A workflow rule is a **blueprint** in the library.
- The WebSocket bus is shown as a "Bus live" pill — green LED when connected, red when offline.

The vocabulary in this guide reflects what you see on screen. The terminology in the codebase keeps the technical names (monitor, group, rule, channel) — the metaphor is purely a UI veneer.

## Signing in

1. Open <https://myccmonitor-frontend.cleverapps.io>.
2. Click **Enter the workshop**.
3. You'll be redirected to `console.clever-cloud.com` to authorise the `myccmonitor-prod` OAuth consumer.
4. Approve the request. Clever Cloud asks for these scopes:
   - `access-personal-information` — to look up your user profile (email, name).
   - `access-organisations` — to list orgs you belong to.
   - `manage-organisations-applications` — required to install webhooks on your orgs and read application state.
   - `manage-organisations-services` — required to fetch Warp10 metrics tokens.
5. After authorisation you land on `/orgs` (the **Workshops** page). A 7-day session cookie keeps you signed in across visits; you can leave the workshop at any time from the user panel at the bottom of the control panel sidebar.

If sign-in fails with `OAuth callback is invalid`, the consumer rights are too narrow — ping the backend operator. Once they widen the consumer, you must sign in again to get a fresh access token; old tokens carry the old grant.

## Hooking up webhooks

Each Clever Cloud organisation needs to send its events to myccmonitor.

1. Go to **Workshops** (`/orgs`) — the first page after sign-in.
2. For each workshop you want to monitor, click **Hook up**.
3. The button is **idempotent**: clicking it again deletes any existing myccmonitor webhook on the org and creates a fresh one. Use **Re-install** if you suspect the hook is broken or the URL has changed.

Once installed, the webhook receives these events:

- `APPLICATION_CREATION`, `APPLICATION_DELETION`, `APPLICATION_REDEPLOY`, `APPLICATION_STOP`
- `GIT_PUSH`, `DEPLOYMENT_SUCCESS`, `DEPLOYMENT_FAIL`
- `ADDON_CREATION`, `ADDON_DELETION`

Each event maps to a monitor state change:

| CC event | Monitor state |
| --- | --- |
| `DEPLOYMENT_SUCCESS` | `ok` |
| `DEPLOYMENT_FAIL` | `critical` |
| `APPLICATION_STOP` | `critical` |
| `APPLICATION_REDEPLOY` / `GIT_PUSH` | `unknown` (deploying) |
| `APPLICATION_CREATION` / `ADDON_CREATION` | the machine row is created |
| `APPLICATION_DELETION` / `ADDON_DELETION` | the machine row is deleted |

State transitions trigger your rules. If you've set up a blueprint that broadcasts a Slack notification on `state == critical`, that's how it gets fired.

## The Control Room

Click any workshop from `/orgs` to land on its **Control Room** at `/orgs/{cc_org_id}`.

**Layout.** Machines are grouped into sectors:

- **Sector A · Applications** — your CC apps (`cc_application` kind).
- **Sector B · Add-ons** — your databases, queues, etc. (`cc_addon`).
- **Sector S · Synthetic** — virtual machines that have no CC backing; their state is mutated only by `setMonitorState` rule actions. Useful for roll-ups like `prod_health`.

Above the sectors, a row of "floor totals" chips shows OK / WARN / CRIT / UNKNOWN counts across the workshop.

Each machine is a riveted-steel card with:

- **LED head + serif name** — the LED pulses by severity (warn = 1.5 s, critical = 0.5 s, ok/unknown = static).
- **Kind tag pill** — `APP`, `ADDON`, `SYNTH`.
- **CPU, MEM, DISK gauges** — copper-to-red gradient bars filled with the latest Warp10 reading (green-to-amber gradient under 75 %, copper-to-amber 75–89 %, copper-to-red ≥ 90 %). Updates every 60 s via the poller.
- **NET line** — a compact `↓ {download} · ↑ {upload}` line below the gauges with auto-scaled units (B/KB/MB/GB per second).
- **Message** — the last status message (e.g. `deploy succeeded`).
- **"Since"** timestamp — how long the machine has held its current state.
- **Bug button** (visible on hover, bottom-right) — opens the per-machine **Diagnostic bench**. See [Monitor diagnostic](#monitor-diagnostic).

When a fresh frame arrives over WebSocket, the whole card briefly emits a copper "spark" pulse so you can spot what just changed.

### Metric rendering states

A gauge (or the NET line) can be in three visual states:

- **Live value** (gradient + percentage / B/s) — fresh sample from CC's Warp10. Updates every poll.
- **Forge shimmer** (animated copper gradient, no value) — the dashboard just opened and we're still hydrating the first sample. Lasts up to ~90 s; if no sample arrives by then, the gauge switches to:
- **`n/a`** (italic, dim) — CC's Warp10 doesn't emit this metric class for this app's runtime. **Not a bug, not a loading state**: the metric is genuinely unavailable. Click the **Bug** button on the card to confirm via the Diagnostic bench — it tells you exactly which classes are missing for this machine.

The dashboard always shows the **last known value per metric**. CC emits some metrics at different cadences (notably `disk.used_percent` ~5 min vs `cpu.usage_user` ~1 min), so a fresh poll may write CPU/MEM but not DISK. The gauge still shows the disk reading from a few minutes ago — the value only goes back to `n/a` after ~50 min of no readings (10 readings × ~5 min cadence).

### Monitor diagnostic

Click the **Bug** icon at the bottom-right of any MachineUnit to open the **Diagnostic bench** dialog. It's a read-only snapshot answering "**why is disk/net empty for this app?**" with the database itself.

What you see:

- **Monitor** — id, kind, current state, `cc_resource_id` (the CC API id, e.g. `app_xxx`/`addon_xxx`), `cc_metrics_id` (the Warp10 lookup key — `realId` for add-ons), last poll timestamp.
- **Metric availability — last 30m of polls**:
  - "**X samples written in the last 30m**" — total readings across all 5 metrics. If `0`, the poller hasn't run yet for this machine; wait ~60 s and refresh.
  - One coloured chip per expected metric (cpu, mem, disk, net_in, net_out): **green** = at least one reading in the window, **red** = no reading. Red chips are the answer: CC simply isn't reporting that class for this app's runtime — there's nothing myccmonitor can fix server-side.
- **Latest sample** — the values that drive the gauges right now. Each metric carries its own `ts` (the moment it was last received), so disk's timestamp may legitimately differ from cpu's by a few minutes.

Hit **Refresh** to re-fetch without closing the dialog. Hit **Close** or `Esc` to dismiss. The diagnostic never mutates anything.

> Different runtimes emit different metric sets. Multi-instance Node.js apps frequently lack disk metrics; some addon types lack network. Compare a "broken" app with a healthy one in the same workshop if you're unsure — if the healthy app's chips are also red, the gap is on CC's side.

**Bus live indicator.** The control panel sidebar shows a "Bus" pill: green LED **Bus live** (WebSocket connected), amber **Reconnecting**, red **Bus offline**. If you see Bus offline for more than ~30 s, refresh the page; the data on screen may be stale.

**State source of truth.** Three paths can change a machine's state:
1. **Webhook arrival** — instant.
2. **The 60-second poller** — reads CC's `state` field on `GET /v2/organisations/{id}/applications`. Catches anything a webhook missed (network glitch, app stopped without an event).
3. **A rule action** — a blueprint with `setMonitorState` writes to the target machine.

Webhooks always win when present (delta truth > poll truth in the same tick).

## Production lines

Production lines (`/groups`) let you treat fleets of machines as one. Use them when a blueprint should react to "any prod app critical" or "≥ 2 EU machines warning".

### Opening a line

1. Go to **Production lines** (`/groups`).
2. Click **+ New line**.
3. Fill in:
   - **Name** — required, unique per user.
   - **Description** — optional.
   - **Auto-match name regex** — optional. A POSIX-style regex applied to `monitor.display_name`. Matching machines are automatically included in the line.
   - **Auto-match kinds** — optional chips (`cc_application`, `cc_addon`, `synthetic`). If set, only machines of these kinds count.
4. Click **Open line**.

Auto-matching rules are conjunctive — a machine is included only if **all** the criteria match.

### Production line detail page

`/groups/{id}` shows:

- **Reactor + assembly belt** — a big circular reactor at the top renders the rolled-up state (OPERATIONAL / WARNING / CRITICAL / UNKNOWN) with severity-driven pulse, surrounded by an animated conveyor of member stations (LED + name) flowing into the reactor.
- **Stat counters** below the assembly: OK / WARN / CRIT / UNKNOWN counts in monospace.
- **Members** — manual + auto-matched, with their current LED + state. You can pull machines from the line or add new ones via the picker.
- **Auto-grouping rules** — a JSON readout of the current criteria.

Lines can be referenced from blueprint conditions as `group:{group_id}:state`, `group:{group_id}:critical_count`, `group:{group_id}:warning_count`, `group:{group_id}:total_count`, etc.

## Blueprints — the visual editor

Blueprints (rules) are the heart of myccmonitor. They watch machines (or production lines), evaluate composite conditions, and execute actions. Open the library at `/rules`.

> **Note on the editor surface.** The visual editor inside `/rules/new` and `/rules/{id}` is currently in transition. The chrome (toolbar, page title, save/dry-run/debug buttons) is Forge-skinned, but the ReactFlow canvas itself still shows the legacy (warm-tone) condition / logical / action / output nodes on a dark canvas. A future revision (Forge Floor) replaces them with industrial sensor / logic gate / actuator machines connected by animated pipes, plus a left palette and right inspector. The behaviour described below — saving, dry-run, debug, cooldown semantics — is unchanged.

### Drafting a new blueprint

Click **+ New blueprint** to land on a blank ReactFlow canvas.

**Toolbar (top).** Blueprint name, an `enabled` checkbox, a **cooldown** number (seconds), and four buttons on the right: **Save**, **Dry-run**, **Delete** (existing blueprints only), **Debug** (existing blueprints only).

**Add-node panel (left).** Click to add nodes:
- **Condition** — compares a property of a monitor or group to a value. Pick `monitor` / `group`, then the target, the property (`state`, `cpu`, `mem`, `critical_count`, …), the operator (`==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `not_contains`), the expected value, and an optional `for X` duration (e.g. `5m`, `30s`, `2h`). The duration only applies when comparing `monitor:{id}:state`; for other properties it is parsed but currently treated as instantaneous.
- **Logical (AND/OR)** — combines conditions. Choose `AND` (all true) or `OR` (any true), and how many input handles (2–6).
- **Action** — what to do on a match. Three kinds:
  - `setMonitorState` — write a new state to a monitor (chains: re-triggers any blueprint watching that monitor).
  - `sendNotification` — pick a transmitter + write a message body (handlebars templating supported, e.g. `{{monitor.display_name}}`).
  - `escalate` — wait `delay_seconds` then re-evaluate a target blueprint. Survives backend restarts (delivered via Pulsar).

**Wiring.**
- Connect Condition outputs into Logical inputs (or directly into the Rule output).
- Connect the Logical output into the **Rule output** node (the gold "Rule output" pill).
- Connect the Rule output's right side into one or more Action nodes — they run in **parallel**.

Click **Re-layout** to auto-arrange the graph left-to-right.

### Cooldown

Cooldown prevents notification storms. After a positive evaluation, `last_fired_at` is updated; subsequent positive evaluations within `last_fired_at + cooldown_seconds` are recorded as `cooldown_skipped` and don't fire actions.

**Recovery-exempt:** if the verdict transitions (e.g. previously matched → not matched, or warning → critical), the cooldown is bypassed. So a recovering app always notifies.

### Saving

When you click **Save**:

- Name must be non-empty, ≥ 1 action node connected.
- Every monitor / group / rule / channel reference must belong to your user (cross-tenant references return 403).
- A static cycle check runs across the rule DAG (`rules → monitors-they-write → rules-that-watch-them`); cycles are rejected.
- Versions are auto-snapshotted (last 5 kept).

If validation fails, a red toast tells you why.

### Dry-run

Click **Dry-run** to evaluate the blueprint against the current state without executing any actions. The toast shows `MATCH · N actions would run` or `no match`.

### Debug

Click **Debug** to open a snapshot panel with everything you need to understand why a blueprint did or did not fire:

- **Verdict box** — `Would match now` (green) or `Would not match` (grey), updated on each open.
- **Cooldown box** — remaining seconds, last fired timestamp, last outcome (`matched` / `not_matched` / `cooldown_skipped` / `error`), and a flag if cooldown would currently skip the next match.
- **Monitors referenced** — every monitor cited in the condition tree, with its live state, since timestamp, and `held_for_seconds`.
- **Groups referenced** — every line cited, with rolled-up state and breakdown.
- **Channels used** — every transmitter cited by `sendNotification` actions, with enabled flag, failure count, last success / failure timestamps, and the last failure message in red if any.
- **Recent firings** — last 10 entries from the audit log (matched / not_matched / cooldown_skipped / error), each with timestamp + trigger kind.
- **Condition tree** — the JSON tree annotated per leaf with `field`, `operator`, `expected`, `actual`, and the leaf's `verdict`. Lets you see exactly which comparison failed.

The Debug panel is read-only — it never mutates state.

## Relay tower

The Relay tower (`/channels`) is where you wire transmitters that `sendNotification` actions broadcast through.

### Wiring a transmitter

Click **+ New transmitter** and pick the **Kind**:

- **Email (SMTP).** Input a list of recipients as **chips** (type, press Enter, repeat). Optional `reply_to` and `subject_prefix`. Uses the SMTP host configured in the backend env.
- **Slack.** Paste a Slack Incoming Webhook URL: `https://hooks.slack.com/services/...`.
- **Discord.** Paste a Discord Webhook URL: `https://discord.com/api/webhooks/...`.
- **Generic webhook.** Choose `POST` or `PUT`, enter a URL, and add **headers** as repeatable key/value pairs. The body is JSON: `{ "subject": "...", "body": "..." }`.

A live JSON preview on the right shows the exact `config` blob that gets persisted to the database.

### Transmitter health

Each transmitter row shows:

- **Antenna plate** on the left with the kind icon (Slack / Email / Discord / generic).
- **LED + name + badges** in the middle: enabled/disabled, kind, `{n} failures` if any.
- **Signal bars** on the right — 5-bar indicator that maps `failure_count` and recent-success state to colour and strength (full green = healthy, partial amber = degraded, all red = failing, dim = disabled).
- **Last success at** and **last failure** timestamps + the last failure message in red.

If a transmitter keeps failing, fix the credentials or the URL and the count will reset on the next successful send. Blueprints referencing a disabled transmitter fail their `sendNotification` action and the blueprint is logged with outcome `error` — the firing still appears in the audit log, just without the side effect.

## Theme

The Forge runs in a single locked dark theme. The previous light/warm pastel theme has been retired so the metaphor stays consistent — entering the workshop is a deliberate shift away from the corporate dashboard look. There is no theme toggle.

## Troubleshooting

### "I clicked Hook up but events aren't arriving"

1. Check the workshop's webhook in the Clever Cloud console — it should point at `https://myccmonitor-frontend.cleverapps.io/webhooks/cc/{token}` (a long random suffix).
2. Click **Re-install** — it deletes the old hook and creates a fresh one (idempotent).
3. Verify the OAuth consumer rights include `manage-organisations-applications`. If a CC error 6201 ("you are not allowed to access this organisation's applications") appears, the consumer is too narrow.
4. Trigger a fake event (e.g. redeploy a tiny app). You should see the machine's LED change live within ~1 s.

### "My blueprint isn't firing"

1. Open the blueprint and click **Debug**.
2. Read the **verdict** — does the condition currently evaluate to true? If not, the **condition tree** below shows which leaf failed (`actual` vs `expected`).
3. Check the **cooldown** — if `would skip` is set, an earlier match is still in cooldown.
4. Check the **channels used** section — any transmitter disabled or with a recent failure?
5. Check the **monitors referenced** section — does the monitor have the state you expect? If it's `unknown`, no webhook has arrived yet.
6. Check **recent firings** — was the blueprint recently evaluated with `not_matched` or `error`? `error` rows include the underlying exception in the audit log.

### "The page is stale"

Look at the **Bus** pill in the control panel sidebar. If it's **Bus offline**, refresh the page. If it stays Offline after a refresh, the backend is unreachable — check `https://myccmonitor-backend.cleverapps.io/health`.

### "I see (unknown) state"

Either:
- No webhook has arrived for that machine yet (newly created apps stay `unknown` until their first deploy event), **or**
- The 60-second poller hasn't completed a cycle since the machine was created. Wait one minute and refresh.

If a machine has been `unknown` for ≥ 5 minutes despite the app being up on CC, check the webhook setup (above).

### "Notification arrived but to the wrong place"

Every notification is recorded in the audit log (`alerts` table). Check the blueprint's recent firings via the Debug panel — each `matched` firing has the action summaries. If the channel ID looks wrong, edit the blueprint's action node and re-save.

### "Some metric gauges show n/a even though others have values"

That's **expected**, not a bug. Different CC runtimes emit different sets of Warp10 classes — Node.js apps often lack `disk.used_percent`, multi-instance setups sometimes lack network metrics, etc.

To confirm:

1. Click the **Bug** icon at the bottom-right of the affected MachineUnit.
2. Look at **Metric availability — last 30m of polls**. Red chips list the metrics CC isn't emitting for this app.
3. Compare with a healthy machine in the same workshop (e.g. a Java app). If the healthy one has all green chips and yours has reds, the gap is genuinely on CC's side and there's nothing the dashboard can do about it.

If **all** metrics for **all** machines show `n/a` after waiting more than ~2 minutes, that points to an outage instead — check `https://myccmonitor-backend.cleverapps.io/health` and look for poller errors in `clever logs --alias myccmonitor-backend`.

### "The disk gauge disappeared then came back a few minutes later"

CC emits `disk.used_percent` every ~5 minutes, while CPU/MEM come every ~1 minute. Older versions of myccmonitor stored "snapshots" (one row per poll with NULL columns when a metric was missed), which made the gauge flicker.

Since Phase 11f, each metric is stored independently (`metric_readings` table) and the dashboard always shows the **last known value per metric**. You should never see flickering anymore. If you do, click the Bug icon to confirm there are samples in the last 30 minutes, and report the screenshot — the carry-forward is broken if disk really alternates between value and `n/a` repeatedly.

### "The blueprint editor crashed"

Refresh the page. If it crashes again, check the browser DevTools console — the error will mention the file and line. Report it with the blueprint ID; the backend has a `GET /api/rules/:id` endpoint that returns the JSON shape so a developer can reproduce locally.

---

That's everything you need to be productive in myccmonitor. For deeper engineering details — workflow engine internals, multi-instance coordination, webhook lifecycle, deploy flow, design system tokens — see [`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md).
