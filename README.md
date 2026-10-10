# Interact Club Hub

Node.js + Express + SQLite backend with session-based login (bcrypt), serving the club hub frontend.

## Run it

```bash
npm install express better-sqlite3 bcrypt express-session better-sqlite3-session-store helmet express-rate-limit dotenv
cp .env.example .env        # then fill in SESSION_SECRET and the SEED_PRESIDENT_* values
npm run db:init             # creates data/club.db and the tables
npm run db:seed             # creates your Co-President account + the 12 sample events
npm run dev                 # http://localhost:3000
```

Generate a session secret:
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## Auth endpoints

| Method | Path | Body | Result |
|---|---|---|---|
| POST | /api/auth/register | name, email, password | 201 + user, logged in as `volunteer` |
| POST | /api/auth/login | email, password | 200 + user |
| POST | /api/auth/logout | none | 200 |
| GET | /api/auth/me | none | `{ user }` or `{ user: null }` |
| GET | /api/events | none | events list (needs login) |

## Roles

New accounts are always `volunteer`. Roles are never accepted from the browser.
The first `pres` is created by the seed script; later promotions will be done by a Co-President.

## Layout

```
src/server.js            app setup, sessions, security headers
src/db.js                SQLite connection + schema loader
src/initDb.js, seed.js   setup scripts
src/middleware/auth.js   attachUser, requireAuth, requireRole
src/routes/auth.js       register / login / logout / me
src/routes/events.js     read-only smoke test
db/schema.sql            users, events, hour_logs
public/index.html        your prototype, now behind login
```
