# vetridigital-serverless

Vetri Digitals backend, ported from the always-on Express server in
[`backend-expense`](https://github.com/hariharan138/backend-expense) to
**Vercel serverless functions**. Business logic (controllers, models, routes,
services) is unchanged — only the app's lifecycle changed.

## What changed vs. `backend-expense`

| Concern | Before (Render, always-on) | Now (Vercel, serverless) |
| --- | --- | --- |
| Entry point | `server.js` → `app.listen()` | `api/index.js` exports the same Express app directly (Vercel's Node runtime calls it as `(req, res)`, which is exactly an Express app's signature); `vercel.json` rewrites every request to it |
| DB connection | Connected once at boot | `config/db.js` caches the connection on `global` and connects lazily on each cold start, reused across warm invocations |
| Daily 9 PM IST report | `node-cron` running inside the process | [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs) hits `GET /api/cron/daily-report` on schedule (`vercel.json`), protected by `CRON_SECRET` |
| Payment-method migration | Ran once automatically at boot | Manual `POST /api/admin/migrate-payment-method` (serverless has no boot step to hook into) |
| Telegram webhook registration | Ran automatically at boot using `RENDER_EXTERNAL_URL` | Manual `POST /api/admin/telegram/set-webhook` after each new deployment URL, using `PUBLIC_URL` or Vercel's `VERCEL_URL` |
| Everything else (routes, controllers, models, auth, PDF/report generation) | — | Unchanged |

## Project structure

```
api/index.js       # Vercel function entry — wraps app.js
app.js             # Express app (routes, CORS, DB-connect middleware)
server.js          # Local-only entry point (node server.js) — Vercel doesn't use this
config/db.js       # Cached Mongoose connection for serverless reuse
controllers/       # unchanged business logic
routes/            # unchanged, plus routes/cron.routes.js and routes/admin.routes.js
models/            # unchanged Mongoose schemas
services/          # unchanged (PDF report, email, Telegram)
middleware/        # unchanged JWT auth guard
vercel.json        # rewrites + cron schedule
```

## Environment variables

Copy `.env.example` to `.env` and fill in real values. Same variables are set
as **Environment Variables** in the Vercel project dashboard for production.

- `MONGO_URI` — MongoDB connection string
- `JWT_SECRET`, `JWT_EXPIRES_IN` — auth tokens
- `CLIENT_URL` — allowed CORS origin (the frontend's deployed URL)
- `PUBLIC_URL` — this backend's own deployed URL (used for the Telegram webhook)
- `CRON_SECRET` — shared secret Vercel Cron sends as `Authorization: Bearer <value>`
- `REPORT_EMAILS`, `SMTP_*` — daily PDF email report
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS` — optional Telegram bot

> **Note:** rotate any credentials that were ever committed to `backend-expense`'s
> `.env.example` before reusing them here — don't copy values from that file.

## Local development

```bash
npm install
cp .env.example .env   # fill in real values

# Option A — closest to production (runs functions the way Vercel does)
npm run dev

# Option B — plain Express server, faster iteration
npm run dev:express
```

## Deploy

```bash
npm i -g vercel   # if not already installed
vercel link       # first time only
vercel env pull   # optional, to sync env vars locally
vercel --prod
```

After the first deploy:

1. Set `PUBLIC_URL` (or rely on `VERCEL_URL`) and `CRON_SECRET` in the Vercel
   project's environment variables, then redeploy.
2. If using the Telegram bot, call `POST /api/admin/telegram/set-webhook`
   (with a valid JWT) once to register the webhook for this deployment's URL.
3. Point the frontend's `PRIMARY_API_URL` / `SECONDARY_API_URL` at this
   deployment's URL (the app already expects an `/api` prefix).

## API routes

Same paths as the original backend: `/api/auth`, `/api/transactions`,
`/api/reports`, `/api/notes`, `/api/notebook`, `/api/payroll`,
`/api/cash-overview`, `/api/telegram/webhook`, `/api/health`, plus the new
`/api/cron/daily-report` and `/api/admin/*` described above.
