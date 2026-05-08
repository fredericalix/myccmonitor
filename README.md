# myccmonitor

Multi-tenant supervision tool for Clever Cloud applications. Login OAuth CC, ingest deployment webhooks via Pulsar, poll Warp10 metrics, evaluate a workflow engine (nested AND/OR conditions, cross-resource rules, chained actions, time-based, group-aware), edit rules in a ReactFlow visual editor, fan out alerts to email/Slack/Discord/webhook.

**Read [`CLAUDE.md`](./CLAUDE.md) before contributing.** It's the spec, the architecture reference, and the onboarding doc.

## Quick start

```bash
cp .env.example .env                              # fill APP_ENCRYPTION_KEY at minimum
docker compose -f docker-compose.dev.yml up -d    # Postgres + Pulsar standalone

# Backend (terminal 1)
cd backend
sqlx migrate run                                  # once Phase 1 lands
cargo run

# Frontend (terminal 2)
cd frontend
npm install
npm run dev                                       # http://localhost:3000
```

## Documentation

- [`docs/USER_GUIDE.md`](./docs/USER_GUIDE.md) — end-user walkthrough of the deployed UI: signing in, webhook setup, the org dashboard, groups, the visual rule editor, notification channels, the debug panel, theme toggle, troubleshooting.
- [`docs/DEVELOPER_GUIDE.md`](./docs/DEVELOPER_GUIDE.md) — English distillation of `CLAUDE.md` for engineers contributing to the codebase.
- [`CLAUDE.md`](./CLAUDE.md) — canonical spec / agent doc / phase log. Source of truth.

## Stack

Rust 1.85+ / Axum / sqlx / tokio · Next.js 16 / React 19 / Tailwind v4 / hand-rolled UI primitives / ReactFlow + Dagre · PostgreSQL · Apache Pulsar · Clever Cloud as deploy target.

## License

Private. Internal tooling.
