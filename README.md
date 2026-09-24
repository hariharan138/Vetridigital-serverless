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
| Payment-method migration | Ran once automatically at boot | Manual `POST /api/admin/migrate-payment-method` (serverless has no boot step to hook into) |
| Everything else (routes, controllers, models, auth, PDF report generation) | — | Unchanged |

> The original backend also had a Telegram bot and a scheduled email report
> (`node-cron` + `nodemailer`). Both were dropped in this port — not needed
> right now. On-demand PDF generation (`GET /api/reports/daily.pdf`) is kept.
> The reference implementations are still in `backend-expense`'s
> `services/dailyReport.js` if either is wanted again later.

## Project structure

```
api/index.js       # Vercel function entry — exports app.js directly
app.js             # Express app (routes, CORS, DB-connect middleware)
server.js          # Local-only entry point (node server.js) — Vercel doesn't use this
config/db.js       # Cached Mongoose connection for serverless reuse
controllers/       # unchanged business logic
routes/            # unchanged, plus routes/admin.routes.js
models/            # unchanged Mongoose schemas
services/          # PDF report generation (email + Telegram dropped, see above)
middleware/        # unchanged JWT auth guard
vercel.json        # rewrites
```

## Environment variables

Copy `.env.example` to `.env` and fill in real values. Same variables are set
as **Environment Variables** in the Vercel project dashboard for production.

- `MONGO_URI` — MongoDB connection string
- `JWT_SECRET`, `JWT_EXPIRES_IN` — auth tokens
- `CLIENT_URL` — allowed CORS origin (the frontend's deployed URL)

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

After the first deploy, point the frontend's `API_URL` at this deployment's
URL (the app already expects an `/api` prefix).

## API routes

Same paths as the original backend, minus the Telegram bot and email report:
`/api/auth`, `/api/transactions`, `/api/reports` (includes
`GET /api/reports/daily.pdf`), `/api/notes`, `/api/notebook`, `/api/payroll`,
`/api/cash-overview`, `/api/health`, plus `/api/admin/*` described above.
