# Interact Club Hub

Express + Supabase (Postgres) backend with session login (bcryptjs). The page in `public/` runs entirely on
live data: there is no sample data anywhere in the app.

## Files

```
server.js         app setup, sessions, user loading, routes, static hosting (only public/ is served)
supabase.js       Supabase client (service_role key)
auth.js           /api/auth/register | login | logout | me
admin.js          /api/admin/*   user roles, pending-hours queue (admin only)
stats.js          /api/stats     dashboard numbers
bootstrap.js      /api/bootstrap everything a screen needs, scoped to who is asking
events.js         create/edit/delete events, sign-ups, volunteer slots, live check-in code, approve-all
hours.js          check-in submission, proof photos, review, overtime, feed (cheer/comment/flag)
people.js         promotion requests, certificates, Rotary CSV export
lib.js            shared helpers (validation, live code, distance, paging)
middleware.js     requireAuth, requireRole, requireAdmin
schema.sql        full schema for a fresh database
migrations/       002 admin role | 003 old cleanup | 004 live app tables | 005 clean slate
public/index.html the app
tests/            node tests/api.js  and  node tests/e2e.js   (no npm install needed)
```

## Set up, in this order

1. Supabase SQL editor: run `migrations/004_live_app.sql` (adds sign-ups, cheers, comments, venue and GPS columns, and row-level security).
2. Supabase SQL editor: run `migrations/005_clean_slate.sql` (read STEP 1 first). It deletes events, sign-ups, hour logs, cheers and
   comments, and keeps every registered account.
3. Render environment: `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL`. Optional: `QR_SECRET`
   (secret for the live check-in codes; defaults to `SESSION_SECRET`).
4. Deploy.

## How the app works now

- **Everything is loaded from `GET /api/bootstrap`** after login and after every change. Nothing is changed in the browser first.
- **Empty is empty.** No events: "No events yet". No posts: "No posts yet". Nothing flagged: "No flagged entries".
- **Who creates events:** Sector Leads (own sector) and Co-Presidents/admins (any sector: switch to the Sector Lead view and pick a sector).
- **Check-in is real:**
  - GPS: the browser's location must be within 200 m of the venue (set with "Use my current location" when creating the event).
  - Live code: a 6-digit code made by the server, changing every 30 seconds, shown on the lead's screen and checked by the server.
  - Photo: taken live with the camera (no uploads). Link: for off-site work.
  - Hours come from the event, never from the member.
- **Roles:** volunteer, member, lead, pres, admin. Co-Presidents promote volunteers; every other role change is an admin's (Admin Panel).
- **Sectors** feed the sector leaderboard. Set them in the Admin Panel (Sector Leads must have one; Members may).
- **Certificate** has a Print / save-as-PDF button; the Rotary report is a real CSV download from the server.

## Removed with the sample data

The in-browser demo (70 invented members, 12 events, fake photos and feed), the "Reset sample data" button, the pretend QR picture,
the distance slider used to fake GPS, the Order-run tracker and the Streak Master badge (it needs event dates the app does not store).

## Tests

`node tests/api.js` (permissions, validation, data scoping) and `node tests/e2e.js` (the real page driving the real routes,
several users, every screen and flow). They use in-memory stand-ins, so they need no database, network or install.
They do not test a real browser camera, GPS chip or Supabase; try those once after deploying.

## Look and feel

Dark glass design system, all in the `<style>` block of `public/index.html`. The colours are CSS variables at the top of it
(`--bg`, `--surface`, `--brand`/`--brand-2` for the blue to cyan actions, `--gold` for Rotary and admin highlights), so a re-theme
is a change to that one block. Fonts are Inter and Plus Jakarta Sans (Google Fonts, with system fallbacks).
The app is dark only; it does not switch with the device's light/dark setting.
Text and button colours were checked against WCAG AA contrast (4.5:1). Animations switch off for people who ask their
device for reduced motion, and blur effects switch off under reduced transparency.
