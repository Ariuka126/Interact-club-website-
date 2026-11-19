# Todo: Hardening the grants + QR check-in release

Plan: `tasks/plan.md`. Verification command for every task: `npm test` (runs all.js, every suite).
Browser checks use the Playwright harness pattern from this session (real page, /api routed into the harness).

## Phase 1: Fix what this release can break

## Task 1: Bootstrap survives a missing migration
**Description:** If `006_hour_grants.sql` has not run, `/api/bootstrap` must still load the app (grants simply absent),
and the server must log exactly which migration is missing at startup.
**Acceptance criteria:**
- [ ] With the grant columns missing, `GET /api/bootstrap` returns 200 and every screen renders
- [ ] Startup logs `[schema] run 006_hour_grants.sql` once when the columns are missing; silent when present
- [ ] Grant and check-in endpoints return a clear 503 ("ask an admin to run the latest migration") instead of a 500
**Verification:**
- [ ] Tests pass: `npm test` (new harness case where `hour_logs` rejects the grant columns)
- [ ] Manual check: harness run with the columns stripped; member, lead and President screens load
**Dependencies:** None
**Files likely touched:** `bootstrap.js`, `supabase.js`, `hours.js`, `events.js`, `grants.js`
**Estimated scope:** M

## Task 2: Grants are labelled correctly in Recent decisions
**Description:** Overrides → Recent decisions lists grants as "President grant: <reason>" (and door check-ins as
"<event> · QR check-in"), never "Deleted event".
**Acceptance criteria:**
- [ ] `GET /api/hours/decided` returns `event: null`, `grant: {type, reason}` for event-less grants
- [ ] The Overrides screen shows "President grant: <reason>" for them
**Verification:**
- [ ] Tests pass: `npm test` (grants.js: grant then open Overrides, text matches, no "Deleted event")
**Dependencies:** None
**Files likely touched:** `hours.js`, `public/index.html`, `grants.js`
**Estimated scope:** S

## Task 3: A President can revoke a mistaken grant
**Description:** Revoking sets the grant to `rejected` with a written reason; totals drop immediately; nothing is deleted.
**Acceptance criteria:**
- [ ] New migration relaxes `hour_logs_event_or_grant_check` to allow `approved` or `rejected` for event-less grants (schema.sql too)
- [ ] Override → rejected on a grant succeeds (200), is audit-logged with the reason, and totals/stats/certificate/CSV drop
- [ ] Overriding a grant back to `pending` is refused with a clear 400 (a grant has no reviewer queue)
**Verification:**
- [ ] Tests pass: `npm test`
- [ ] Manual check: grant 2 h → Command Center total +2 → revoke → total back
**Dependencies:** Task 2
**Files likely touched:** `007_grant_revoke.sql`, `schema.sql`, `hours.js`, `public/index.html`, `grants.js`
**Estimated scope:** M

## Checkpoint A: Safe to deploy
- [ ] `npm test` green
- [ ] App loads against a DB without 006 (Task 1); with 006 + 007, grant → see → revoke works
- [ ] Review with human before Phase 2 (answers to Open Questions 1–4 needed)

## Phase 2: Make door check-in trustworthy and complete

## Task 4: Signed member badges
**Description:** The badge QR carries `interact-member:<id>.<hmac>`; `POST /api/events/checkin` accepts a `badge` string
and verifies the signature, so a hand-made code cannot check someone in.
**Acceptance criteria:**
- [ ] `GET /api/me/badge` returns the signed token for the logged-in member only
- [ ] Check-in with a valid badge → 201; tampered id or signature → 400 "not a valid club badge"; roster fallback (officer picks a name) still works by `userId`
- [ ] Badge dialog renders the signed token; scanner sends it unchanged
**Verification:**
- [ ] Tests pass: `npm test`
- [ ] Manual check: Chromium fake-camera scan of a real badge → checked in; scan of a plain `interact-member:5` → refused
**Dependencies:** Checkpoint A
**Files likely touched:** `lib.js`, `people.js`, `events.js`, `public/index.html`, `grants.js`
**Estimated scope:** M

## Task 5: Walk-in check-in at the door (only if Open Question 1 = yes)
**Description:** When a scanned member is not signed up, the dialog offers "Add as walk-in and check in", which signs
them up and checks them in in one step, respecting capacity.
**Acceptance criteria:**
- [ ] `POST /api/events/checkin` with `walkIn: true` creates the sign-up and the approved log atomically; full event → 409
- [ ] The scanner shows the walk-in button only on the "not signed up" response
**Verification:**
- [ ] Tests pass: `npm test` (walk-in ok, full event refused, volunteer still refused)
**Dependencies:** Task 4
**Files likely touched:** `events.js`, `public/index.html`, `grants.js`
**Estimated scope:** S

## Task 6: Presidents can start a door scan without switching views
**Description:** Command Center lists today's active events with a "Scan QR Check-In" button that opens the same dialog.
**Acceptance criteria:**
- [ ] Active events appear as one compact row in Command Center (no new card stack); empty state when none
- [ ] Button opens the existing scanner dialog; check-in works as a President
**Verification:**
- [ ] Tests pass: `npm test` (e2e tiles test still matches; new row asserted)
- [ ] Manual check: screenshot of Command Center desktop + phone
**Dependencies:** Task 4
**Files likely touched:** `public/index.html`, `grants.js`
**Estimated scope:** S

## Checkpoint B: Club-night ready
- [ ] `npm test` green
- [ ] Real camera scan in Chromium of a signed badge; plain/forged badge refused
- [ ] Tried once on a real phone (iOS Safari and Android Chrome) over HTTPS
- [ ] Review with human

## Phase 3: Polish

## Task 7: Dark mode borders readable
**Description:** Replace hard-coded `#111` borders/shadows in the theme with `var(--ink)` (or dark-mode overrides) so cards, inputs and buttons are outlined in dark mode.
**Acceptance criteria:**
- [ ] In `prefers-color-scheme: dark`, every card, input, button, tab and table has a visible border
- [ ] Light mode pixel-identical in the 12 reference screens
**Verification:**
- [ ] Tests pass: `npm test`
- [ ] Manual check: before/after screenshots light + dark
**Dependencies:** None (parallel-safe)
**Files likely touched:** `public/index.html`
**Estimated scope:** S

## Task 8: Grants on the certificate and readable audit actions
**Description:** The certificate's project list includes grant reasons; the audit log shows "Granted hours", "QR check-in", etc. instead of raw ids.
**Acceptance criteria:**
- [ ] `GET /api/certificate/:id` projects include recent grant reasons (max 4 total, newest first)
- [ ] Audit view maps known action ids to labels; unknown ids still shown raw
**Verification:**
- [ ] Tests pass: `npm test`
**Dependencies:** None (parallel-safe)
**Files likely touched:** `people.js`, `public/index.html`, `grants.js`
**Estimated scope:** S

## Task 9: Dialog focus management
**Description:** Opening any dialog moves focus to its first control; Tab stays inside; closing returns focus to the button that opened it.
**Acceptance criteria:**
- [ ] Focus moves into the dialog on open and back to the opener on close (Esc, Close, scrim)
- [ ] Dialogs have an accessible name (`aria-labelledby` on the heading)
**Verification:**
- [ ] Tests pass: `npm test`
- [ ] Manual check: keyboard-only run of grant, badge and scanner dialogs in Chromium
**Dependencies:** None (parallel-safe)
**Files likely touched:** `public/index.html`
**Estimated scope:** S

## Checkpoint C: Complete
- [ ] All acceptance criteria met; `npm test` green
- [ ] Screenshots light / dark / phone reviewed
- [ ] Ready for PR
