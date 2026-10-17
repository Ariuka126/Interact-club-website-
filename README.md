# Interact Club Hub

Express + Supabase (Postgres) backend with session login (bcryptjs), serving the frontend from `public/`.

## Files

```
server.js        app setup, sessions, user loading, routes, static hosting
auth.js          /api/auth/register | login | logout | me
admin.js         /api/admin/users | update-role | pending-hours | review-hour | hour-photo/:id (admin only)
middleware.js    requireAuth, requireRole, requireAdmin
migrations/      SQL to run in Supabase (002 adds the admin role, 003 wipes sample data)
supabase.js      Supabase client (service_role key)
seed.js          first admin account (demo events only with --sample-events)
schema.sql       run once in the Supabase SQL editor
public/index.html the frontend (only this folder is served)
```

## Setup

1. Supabase: SQL editor > run `schema.sql` (new projects) or `migrations/002_admin_role.sql` (existing ones; put your email in step 2 of that file).
2. `npm install connect-pg-simple` (persistent sessions), then commit `package.json` and `package-lock.json`.
3. Render > Environment: set `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL` (see `.env.example`).
4. Create your first admin, with the seed variables set locally: `node seed.js`.

## Check it

`/api/auth/me` in a browser should return `{"user":null}`.

## Hour approvals

Admin Panel > Pending Approvals lists every `hour_logs` row with `status = 'pending'`.
Approve/Reject calls `POST /api/admin/review-hour`, which records `reviewed_by` and `reviewed_at`.
Admins cannot review their own hours. The queue stays empty until members can submit hours
(a `POST /api/hours` route, not built yet).
