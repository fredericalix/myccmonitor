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

## Stack

Rust 1.85+ / Axum / sqlx / tokio · Next.js 15 / React 19 / Tailwind / shadcn/ui / ReactFlow + Dagre · PostgreSQL · Apache Pulsar · Clever Cloud as deploy target.

## License

Private. Internal tooling.
