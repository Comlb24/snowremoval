# Status — first version (Nov 22, 2026)

## What works (checked by hand in this session)

Web admin, in the browser on this Mac:
- Sign in with demo accounts.
- Overview: today's routes with progress, blocked properties, failed messages.
- Add a client with a property. The location is looked up (simulated in development) and labelled.
- Client page: edit contact and SMS or voice choice, opt out, add properties, mark a property inactive, create, replace or revoke a private status link, view visit and message history, send an immediate message.
- Route builder: pick a day, driver, start and properties. An efficient order is suggested. Each stop shows its estimated arrival, its 2-hour window, and its message time.
- Moving a stop up or down recalculates all estimates (checked: one stop moved from 7:56 to 7:32 a.m.).
- Publish, pause, resume, cancel.
- Communications: all messages with a Simulated label, filters, "Run scheduler now", immediate message to a client or a route.
- Public status page on a phone-sized screen: shows "Scheduled" with the window, then "Completed".

Mobile app (iOS simulator, iPhone 17, Expo Go):
- Driver: sign in, see only their own published routes (drafts hidden), start the shift (no messages sent), see next stop and progress, open a stop.
- Phone number hidden until "Show phone number" is tapped, then "Call (506) 555-…". Hidden again after leaving the stop.
- Mark completed with no photo. The admin sees "Completed — no photo".
- Offline: with the server stopped, the stop opened from the saved route, was marked completed, and showed "Pending sync: 1 update". When the server came back it synced once (one request) and the banner cleared.
- Client: "My service" shows both of Jane's properties with status and window.

## Automated tests (`npm test`): 48 passing

Shared rules (28): spec example (10:00 → 9–11, message at 8), drive + service sums, reordering changes estimates, daylight saving (Mar 8 and Nov 1, 2026, plus windows that cross the clock change), progress-based recalculation, early shift start, crew ahead of plan, scheduling, idempotency, stale replacement, late publication (one immediate message, no back-fill), update only outside the told window, minimum gap and update limit, pause/cancel/draft cancel, completed/blocked/removed/opted-out never notified, removed stops, shift start sends nothing, ordering, templates, phone redaction, CSV grouping and validation.

Backend + database permission rules (20), on the embedded Postgres with the real migrations: driver sees only own published routes, drivers cannot read contacts or messages, no phone numbers in driver data, client sees only own (multiple) properties, public role reads nothing, drivers cannot change properties, phone reveal only for the assigned driver and logged without the number, reorder replaces stale messages with no duplicates, real messenger refused outside production, repeated scheduler runs create no duplicates, shift start sends nothing, late publication, simulated failure recorded, pause/resume, opted-out skipped for manual messages, stop update sent 3 times applies once, status link updates and revocation, photo stored once on retry and private, blocked reason, CSV import of one client with several properties (re-import skips duplicates), input validation.

Also checked by hand through the API: photo upload retry → stored once; another driver → refused (403); photo readable by admin, assigned driver and owning client only; no sign-in → 401.

## Not verified yet (needs your accounts or a deployment)

- Supabase: migrations on a real project, Supabase Auth sign-in, private storage bucket, driver invite. The code exists but has not run against Supabase.
- Twilio: real SMS, real voice calls, delivery webhooks. Built with the official SDK, never run (no credentials; development can never send).
- Mapbox: real address lookup and road travel times. Built from the current API docs, never run.
- Production scheduler cron (the endpoint works; no cron is set up).
- Photo capture in the simulator UI (the simulator has no camera). The upload path was tested through the API and the tests.
- Android (not run). The Expo code is cross-platform.
- App Store or Play Store builds.

## Known limits

- The SMS template says "today". A route starting near midnight can get a message the evening before.
- Removing a stop from an already started route keeps its position history only in the message log.
- The local embedded database supports one server process. Production must use `DATABASE_URL`.
