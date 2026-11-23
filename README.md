# Snow Removal Platform — first version

One platform for three roles:

```
           ┌──────────────── Web app (Next.js) ────────────────┐
 Admin ──▶ │ Overview · Clients & Properties · Routes ·        │
           │ Drivers · Communications                          │
 Client ─▶ │ Private status link /s/<token> · signed-in view   │
           │ API for the mobile app · scheduler endpoint       │
           └───────────────┬───────────────────────────────────┘
                           │ Postgres (Supabase) with row-level security
 Driver ──▶ Mobile app (Expo) ── offline route cache + sync queue
 Client ──▶ Mobile app (Expo) ── "My service" view
```

## Quick start (local, no accounts needed)

Needs Node 24 and npm.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3100. Pick a demo account on the sign-in screen.
The first start creates synthetic demo data (made-up names, 555-01xx numbers).

Mobile app (in a second terminal; opens the iOS simulator with Expo Go):

```bash
npm run ios -w @snow/mobile -- --port 8091
```

Tests:

```bash
npm test
```

Start over with fresh demo data (stop the web app first):

```bash
npm run db:reset
```

### Development mode — what is real and what is simulated

| Part | Development | How to make it real |
|---|---|---|
| Database | Embedded Postgres in `.data/pglite`, same migrations and permission rules as Supabase | `DATABASE_URL` |
| Sign-in | Demo account picker (turned off in production) | `AUTH_MODE=supabase` |
| SMS and calls | **Simulated. Nothing is ever sent.** Shown as "Simulated" everywhere. Numbers ending in 0000 simulate a failure. | `APP_ENV=production`, `MESSAGING_MODE=live`, Twilio values |
| Addresses and travel times | **Simulated** (made-up locations near Moncton, distance-based times). Labelled "Simulated travel times". | `ROUTING_MODE=mapbox`, `MAPBOX_TOKEN` |
| Photos | Files in `.data/photos`, served only after a permission check | `STORAGE_MODE=supabase` |
| Scheduler | Runs every minute inside the web server | A cron calling `/api/jobs/scheduler` |

A yellow banner at the top of the web app says when messages or routing are simulated.

## How arrival windows and notifications work

```
planned start ──drive──▶ stop 1 (service) ──drive──▶ stop 2 ...
estimated arrival = planned start + driving + service time at earlier stops
window  = estimate (rounded to 15 min) ± 1 hour      e.g. 10:00 → 9:00–11:00
message = 1 hour before the window starts            e.g. 8:00
```

- Starting a shift sends nothing. Each client is messaged at their own time.
- Estimates follow real progress. A delay pushes estimates later. Running ahead never moves them earlier than planned, so clients are never told to move their cars earlier.
- If a new estimate falls outside the window a client was told, they get one updated window. At most 2 updates per stop, 30 minutes apart.
- Reordering, removing stops, pausing or cancelling a route replaces or cancels waiting messages at once.
- Completed, blocked and removed stops, opted-out clients and inactive properties are never messaged.
- Publishing late: if a message time has passed, one message goes out right away with the current estimate. Older messages are never sent.
- Every message gets a unique key in the database, so duplicates are impossible, even with two workers.
- Failed messages appear on Overview and Communications.

Notification limits: the SMS template says "today". A route that starts close to midnight can get a message the evening before.

## Going live (needs your accounts)

1. **Supabase** (free plan is fine to start): create a project. Then run the migrations in `supabase/migrations` (Supabase CLI `supabase db push`, or paste them into the SQL editor in order). Do **not** run `supabase/dev/auth-shim.sql` on Supabase.
2. Copy `docs/env.example` to `apps/web/.env.local`. Fill in `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `CRON_SECRET`. Set `AUTH_MODE=supabase` and `STORAGE_MODE=supabase`.
3. Create the first admin: add a user in Supabase (Authentication > Users), then in the SQL editor run
   `insert into profiles (id, role, full_name, email) values ('<user id>', 'admin', 'Your Name', 'you@example.com');`
   Add drivers from the Drivers page. To link a client login, set `clients.user_id` to a profile with role `client`.
4. **Scheduler**: call `/api/jobs/scheduler` every minute with the header `Authorization: Bearer <CRON_SECRET>`. Options: Vercel Cron (Pro plan for per-minute jobs), Supabase `pg_cron` + `pg_net`, or any external cron service.
5. **Twilio**: buy a number. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. Set `MESSAGING_MODE=live` and `APP_ENV=production`. Delivery updates arrive at `/api/webhooks/twilio` (needs an https `PUBLIC_BASE_URL`). Canadian SMS may need number registration with Twilio first.
6. **Mapbox**: create a token. Set `ROUTING_MODE=mapbox` and `MAPBOX_TOKEN`.
7. **Mobile**: set `EXPO_PUBLIC_API_URL` to your https address. Build with EAS (`npx eas build`) for the App Store and Google Play.

## Project layout

- `packages/core` — shared rules: arrival windows, notification planner, stop ordering, message templates, CSV import, validation. Used by web, backend and mobile.
- `packages/server` — database access, permissions, services, Twilio / Mapbox / storage adapters, scheduler.
- `apps/web` — Next.js admin, client pages, API for mobile.
- `apps/mobile` — Expo app for drivers and clients.
- `supabase/migrations` — schema and row-level security policies.

See [docs/STATUS.md](docs/STATUS.md) for what works, what was tested, and what still needs credentials.
