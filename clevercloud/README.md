# Clever Cloud setup

myccmonitor ships as **two CC apps** (backend + frontend) plus **two addons** (Postgres + Pulsar). Bootstrap with `clever-tools`:

```bash
# Once, per environment (dev/prod). From the repo root.

# 1. Login (interactive, OAuth)
clever login

# 2. Create the backend app
cd backend
clever create --type rust myccmonitor-backend --org <orga-id>
clever scale --min-instances 2 --max-instances 4 --flavor S    # multi-instance from day 1
cd ..

# 3. Create the frontend app
cd frontend
clever create --type node myccmonitor-frontend --org <orga-id>
cd ..

# 4. Create addons and link them to the backend
clever addon create postgresql-addon myccmonitor-pg --plan dev --org <orga-id>
clever addon create addon-pulsar myccmonitor-pulsar --plan dev --org <orga-id>
clever service link-addon myccmonitor-pg --app myccmonitor-backend
clever service link-addon myccmonitor-pulsar --app myccmonitor-backend

# 5. Set env vars on the backend (consumer key/secret are public, encryption key MUST be unique per env)
clever env --app myccmonitor-backend set CC_CONSUMER_KEY "T5nFjKeHH4AIlEveuGhB5S3xg8T19e"
clever env --app myccmonitor-backend set CC_CONSUMER_SECRET "MgVMqTr6fWlf2M0tkC2MXOnhfqBWDT"
clever env --app myccmonitor-backend set APP_ENCRYPTION_KEY "$(openssl rand -hex 32)"
clever env --app myccmonitor-backend set PUBLIC_BASE_URL "https://myccmonitor-frontend.cleverapps.io"

# 6. Frontend env: tell Next.js where to proxy /api, /auth, /ws, /webhooks
clever env --app myccmonitor-frontend set BACKEND_INTERNAL_URL "https://myccmonitor-backend.cleverapps.io"

# 7. Deploy
cd backend && clever deploy --app myccmonitor-backend
cd ../frontend && clever deploy --app myccmonitor-frontend
```

## Per-app runtime hints

- `backend/clevercloud/rust.json` — pin the binary name and build command.
- `frontend/` — Next.js standard. CC auto-detects from `package.json`.

## Notes

- Backend MUST run with ≥ 2 instances in prod (workflow engine + WS broadcast assumes multi-instance — see `CLAUDE.md` §16).
- Frontend can run with 1 instance (single-origin proxy to backend).
- Postgres `LISTEN/NOTIFY` and advisory locks both work on the CC Postgres addon (no extension required).
- Pulsar topics `cc-webhooks` (30d retention) and `rule-escalations` (1d retention) are created at backend boot via `ensure_topic_exists` (idempotent).
