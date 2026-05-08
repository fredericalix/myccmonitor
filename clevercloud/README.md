# Clever Cloud setup

myccmonitor ships as **two CC apps** (backend + frontend) plus **two addons** (Postgres + Pulsar). Bootstrap with `clever-tools`.

**Defaults** (apply to every command below):

- Org: `orga_5d2b4f5b-434c-4ee4-927a-db6ebff63b50`
- Run flavor: `XS`, build flavor: `S`
- Backend: `--min-instances 2` in prod (multi-instance is required, see CLAUDE.md §16)
- Frontend: `--min-instances 1`

```bash
# Once, per environment (dev/prod). From the repo root.

ORG=orga_5d2b4f5b-434c-4ee4-927a-db6ebff63b50

# 1. Login (interactive)
clever login

# 2. Create the OAuth consumer for myccmonitor (callback whitelisting).
#    The public clever-tools key does NOT accept arbitrary callbacks.
clever oauth-consumers create myccmonitor-prod \
    --description "myccmonitor (prod)" \
    --url       "https://myccmonitor-frontend.cleverapps.io" \
    --base-url  "https://myccmonitor-frontend.cleverapps.io" \
    --picture   "https://www.clever-cloud.com/favicon.ico" \
    --rights    "access-personal-information,access-organisations,manage-organisations-applications,manage-organisations-services" \
    --org $ORG
# Rights breakdown:
#   access-personal-information       → /v2/self
#   access-organisations              → list orgs
#   manage-organisations-applications → list apps + addons of an org (CC's "access" suffix only exists for manage); also gates webhook creation per error 6201
#   manage-organisations-services     → manipulate notification webhooks attached to the org
clever oauth-consumers get <key-from-create> --with-secret    # save these for step 5

# 3. Create the backend app
cd backend
clever create --type rust myccmonitor-backend --org $ORG
clever scale --flavor XS --build-flavor S --min-instances 2 --max-instances 4
cd ..

# 4. Create the frontend app
cd frontend
clever create --type node myccmonitor-frontend --org $ORG
clever scale --flavor XS --build-flavor S --min-instances 1
cd ..

# 5. Create addons and link them to the backend
clever addon create postgresql-addon myccmonitor-pg --plan dev --org $ORG
clever addon create addon-pulsar myccmonitor-pulsar --plan dev --org $ORG
clever service link-addon myccmonitor-pg --app myccmonitor-backend
clever service link-addon myccmonitor-pulsar --app myccmonitor-backend

# 6. Set env vars on the backend (paste the consumer key/secret from step 2)
clever env --app myccmonitor-backend set CC_CONSUMER_KEY "<key>"
clever env --app myccmonitor-backend set CC_CONSUMER_SECRET "<secret>"
clever env --app myccmonitor-backend set APP_ENCRYPTION_KEY "$(openssl rand -hex 32)"
clever env --app myccmonitor-backend set PUBLIC_BASE_URL "https://myccmonitor-frontend.cleverapps.io"

# 7. Frontend env: tell Next.js where to proxy /api, /auth, /ws, /webhooks
clever env --app myccmonitor-frontend set BACKEND_INTERNAL_URL "https://myccmonitor-backend.cleverapps.io"

# 8. Deploy
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
