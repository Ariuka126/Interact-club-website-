# Interact Club Hub

Express + Supabase (Postgres) backend with session login (bcryptjs), serving the frontend from `public/`.

## Files

```
server.js        app setup, sessions, user loading, routes, static hosting
auth.js          /api/auth/register | login | logout | me
supabase.js      Supabase client (service_role key)
seed.js          first Co-President + sample events
schema.sql       run once in the Supabase SQL editor
public/index.html the frontend (only this folder is served)
```

## Setup

1. Supabase: SQL editor > run `schema.sql`.
2. `npm install connect-pg-simple` (persistent sessions), then commit `package.json` and `package-lock.json`.
3. Render > Environment: set `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL` (see `.env.example`).
4. Create your first Co-President, with the seed variables set locally: `node seed.js`.

## Check it

`/api/auth/me` in a browser should return `{"user":null}`.
