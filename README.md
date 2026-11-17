# ÉLAN: the API

The Express and Socket.IO service behind **ÉLAN**, a candle-lit restaurant. It owns every business rule: pricing, order status flow, payments, reservations, permissions, rewards, inventory and analytics. The website (the sibling `client` repository) only shows what this service decides.

> **Live API:** https://elan-server-p8qd.onrender.com

## What it does

- **REST API, 162 endpoints** under `/api`, all answering in one envelope: `{ "ok": true, "data": ..., "meta": ... }` or `{ "ok": false, "error": { "code", "message", "details" } }`. Every request body, query and parameter is validated with Zod.
- **Server-side pricing.** The client sends dish ids and choices, never prices. VAT, service charge (dine-in), delivery fee, coupons and reward points are calculated here, and each order stores the prices it was sold at.
- **A guarded order lifecycle.** `pending_payment` or `placed`, then `confirmed`, `preparing`, `ready`, `out_for_delivery`, `delivered`, with cancellation and rejection where allowed. Each role may make only its own moves, and every change is conditional on the status the caller saw, so two people clicking at once cannot overwrite each other.
- **Payments with real verification.** A sandbox provider stands in for card, bKash and Nagad. An order becomes paid only through a signed event (HMAC-SHA256 over the raw body) whose order reference, amount and currency match, and each event id is applied once. Cash on delivery is supported.
- **Reservations that cannot double-book.** Seatings, party-size rules, automatic table choice and a partial unique index on table, date and seating.
- **Sessions, not tokens in the browser.** A random id stored hashed in MongoDB, sent as an `httpOnly` cookie; scrypt password hashing; a 15-minute lock after five wrong passwords.
- **Roles and permissions.** Customer, chef, delivery, manager and owner, each with an explicit permission list checked on every route; every important change is written to an audit log.
- **Live updates** over Socket.IO: one room per order, plus kitchen, delivery, admin and per-user rooms. Sockets only announce that something changed.
- **Background jobs** in-process: an e-mail queue with retries, a sweep that cancels unpaid orders after 30 minutes, and a birthday-reward job.
- **Rewards, coupons, reviews, inventory with recipe deductions, supplier list, PDF invoices, analytics with CSV export, support chat, newsletter, content and gallery management.**
- **A seed command** that builds the menu, tables and settings, a production-safe owner account, or a full demo history.

## Stack

Node 22, Express 5, Mongoose 8 on MongoDB, Socket.IO 4, Zod, Helmet, `express-rate-limit`, Multer and Cloudinary for uploads, Nodemailer, PDFKit. It is plain ES modules (no build step).

## Getting started

You need Node 22 or newer and a MongoDB (a free Atlas cluster, or MongoDB 7 or newer installed locally).

```bash
cp .env.example .env      # set MONGODB_URI if MongoDB is not on this computer
npm install
npm run seed:demo         # menu, tables, demo accounts, six weeks of sample orders
npm run dev               # http://localhost:5000
```

Check `http://localhost:5000/api/health`: it should report `"status": "ok"` and `"database": "connected"`.

Then start the website from the `client` repository.

### Demo accounts

After `npm run seed:demo`, every account uses the password **`Elan@Demo2026`** (published on purpose, so the demo seed refuses to run in production unless `ALLOW_DEMO_SEED=true`):
`owner@elan.demo`, `manager@elan.demo`, `chef@elan.demo`, `rider@elan.demo`, `rider2@elan.demo`, and the customers `rahim@elan.demo` and `maliha@elan.demo`.

### Seed commands

| Command | What it does |
|---|---|
| `npm run seed:demo` (or `npm run seed`) | Content, demo accounts, and generated orders, bookings, reviews and chats |
| `npm run seed:reset` | Removes only the demo data and builds it again, so the live boards look current |
| `npm run seed:content` | Menu, tables, settings, FAQs and coupons. Safe on production and safe to repeat; never overwrites edits |
| `npm run seed:admin` | Creates the first owner from `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12 or more characters) and `ADMIN_NAME` |

`node seed.js --demo --dry-run` builds the demo data in memory and prints a summary without touching a database.

The seed also gives every dish its photograph (`seed/data/photos.js`; credits in `docs/photo-credits.md`). Running it again on a database that already holds the dishes adds a photograph only to dishes that have none, never replacing one an owner chose. If the database holds another project's unique index (the cause of `E11000 duplicate key ... booking_1`), the seed stops and explains it; use a database of its own, or `--skip-index-check` if you know the index is harmless.

## Environment

Copy `.env.example` and see the comments in it. The ones that matter most:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string. Required in production. End it with the database name (`.../elan`); if it names none, ÉLAN uses `elan` rather than MongoDB's default `test`. |
| `CLIENT_ORIGINS` | Comma-separated exact origins of the website (no trailing slash, no wildcard). Production refuses `localhost`. |
| `PUBLIC_CLIENT_URL` | The website's public address, used in e-mails and payment redirects |
| `TRUST_PROXY` | Number of reverse proxies in front of the API: `1` with Render alone, `2` when the Vercel site forwards `/api` to Render |
| `SOCKET_TOKEN_SECRET`, `PAYMENT_WEBHOOK_SECRET` | Long random secrets. Development defaults work locally and are refused in production. |
| `COOKIE_SECURE`, `COOKIE_SAMESITE`, `SESSION_TTL_DAYS` | Session cookie settings. The defaults (`auto`, `lax`, 30) suit the Vercel-in-front set-up. |
| `RESTAURANT_TZ_OFFSET_MINUTES` | Restaurant time zone as minutes from UTC (`360` for Dhaka) |
| `SMTP_*`, `EMAIL_FROM` | Optional. Without `SMTP_HOST`, e-mails are logged (recipient masked) and in-app notifications still appear. |
| `CLOUDINARY_*` | Optional. Without them uploads go to `./uploads`, which Render wipes on every deploy. |
| `ALLOW_DEMO_SEED`, `DEMO_MODE` | Demo switches. Leave both `false` for a real restaurant. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with automatic restart on file changes |
| `npm start` | Start for production |
| `npm test` | 130 unit tests, no database needed |
| `npm run docs:api` | Regenerate the endpoint tables in `docs/api-documentation.md` from the real route files |

## Where things are

```
server.js       Starts HTTP and Socket.IO, connects the database, starts the jobs
app.js          The Express app and its middleware chain
config/         Environment validation (refuses unsafe production settings), database connection
middleware/     Request id, sessions and permissions, validation, rate limits, origin guard, errors
routes/         One file per area; each exports its base path, and index.js mounts them all
services/       Business rules: pricing, orders, payments, reservations, loyalty, inventory, analytics...
models/         Mongoose schemas, with the indexes that enforce integrity
serializers/    The shapes sent to browsers (the public order view never exposes contact details)
sockets/        Authentication and rooms for live updates
jobs/           E-mail queue, unpaid-order sweep, birthday rewards
seed/, seed.js  Menu content, demo accounts and history, and the seed command
scripts/        The API documentation generator
tests/          Unit tests
```

## Deploying to Render

`render.yaml` is a Render blueprint: create a Blueprint from this repository and enter `MONGODB_URI`, `CLIENT_ORIGINS` and `PUBLIC_CLIENT_URL` when asked; the two secrets are generated for you. The health check is `/api/health`. The step-by-step guide, including MongoDB Atlas and the website, is `docs/deployment.md`.

Run exactly **one** instance: the job queue, the sweep, rate limits and socket rooms live inside the process.

## Checks

This code was written in an environment with no access to the npm registry or a MongoDB server, so it has been tested only with unit tests and static checks: the rules (pricing, status transitions, payment signatures, reservations, permissions) are covered, but the server has **not been started against a real database**. Follow the ten-step first-run checklist in `docs/test-report.md` before deploying.
