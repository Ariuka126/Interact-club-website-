# Implementation Plan: Hardening the grants + QR check-in release

Source spec: none in the repo. Based on the President's feedback brief (de-bloat, Custom Grant Hours, QR check-in),
what shipped on `claude/keen-planck-swuqda`, and a read-only review of the code after it shipped.

## Overview
The release works end to end (573/573 checks, real camera scan verified in Chromium). The review found two bugs
introduced by grants, one deploy risk, and a handful of gaps that stop the features from being "done" for a real
club night. This plan fixes the bugs first, then closes the gaps, then polishes. Every task is a vertical slice
(database → route → screen → test) and leaves the app working.

## What the review found (evidence)
| # | Finding | Where | Severity |
|---|---------|-------|----------|
| F1 | A President's grant shows as **"Deleted event"** in Overrides → Recent decisions | `hours.js:262` maps a missing event title to "Deleted event"; grants have no event | Bug |
| F2 | A mistaken grant **cannot be undone**: Override → rejected or Remove hours violates `hour_logs_event_or_grant_check` (event-less rows must be `approved`) → 500 | `006_hour_grants.sql`, `hours.js` override + remove-hours | Bug |
| F3 | If the app deploys **before** `006_hour_grants.sql` runs, `/api/bootstrap` selects missing columns and **nobody can load the app** | `bootstrap.js` LOG_COLS + `.is('grant_type', null)` | Deploy risk |
| F4 | Badges encode a plain member id: anyone can print `interact-member:12` and be checked in as member 12 if the officer is not looking at faces | `public/index.html` BADGE, `events.js` checkin | Medium (trust) |
| F5 | Walk-ins cannot be checked in at the door (must be signed up first) | `events.js` checkin | Product decision |
| F6 | Presidents have no Events tab, so to scan they must switch to the Sector Head view | `TABS.pres` | UX |
| F7 | Dark mode: cards, inputs and buttons keep hard-coded `#111` borders, invisible on the dark background (pre-existing) | theme CSS | Polish |
| F8 | Certificate "projects" list ignores grant reasons; audit log shows raw action ids (`hours.qr_checkin`) | `people.js`, audit view | Polish |
| F9 | Dialogs do not move keyboard focus in or restore it on close (pre-existing; new dialogs inherit it) | `modal()` | Accessibility |

## Architecture Decisions
- **Grants stay in `hour_logs`** (approved, `event_id` NULL). It is what makes totals, leaderboard, certificate and CSV
  update with no extra code. F1/F2 are fixed around that choice, not by moving grants to a new table.
- **Revoking a grant = status `rejected`, never a delete.** History and the audit trail stay intact; totals already
  count only `approved`. The DB check is relaxed to allow `approved` or `rejected` for event-less grants.
- **Signed badges reuse the live-code HMAC** (`lib.js` qrSecret). Token = `interact-member:<id>.<sig>`; the server
  verifies the signature, so the page never needs the secret. Static per member (printable), not rotating.
- **Deploy safety lives in the server**, not in the README: a startup check plus a bootstrap that still loads (grants
  hidden) when the columns are missing.

## Task List
See `tasks/todo.md` for full tasks with acceptance criteria and verification.

### Phase 1: Fix what this release can break (fail fast)
- [ ] Task 1: Bootstrap survives a missing migration (F3)
- [ ] Task 2: Grants are labelled correctly in Recent decisions (F1)
- [ ] Task 3: A President can revoke a mistaken grant (F2)

### Checkpoint A: Safe to deploy
- [ ] `npm test` green; app loads on a DB without 006; grant can be granted, seen and revoked

### Phase 2: Make door check-in trustworthy and complete
- [ ] Task 4: Signed member badges (F4)
- [ ] Task 5: Walk-in check-in at the door (F5, only if approved; see Open Questions)
- [ ] Task 6: Presidents can start a door scan without switching views (F6)

### Checkpoint B: Club-night ready
- [ ] Real camera scan of a signed badge in Chromium; forged/plain badge refused; walk-in path (if built) respects capacity

### Phase 3: Polish
- [ ] Task 7: Dark mode borders readable (F7)
- [ ] Task 8: Grants on the certificate + readable audit actions (F8)
- [ ] Task 9: Dialog focus management (F9)

### Checkpoint C: Complete
- [ ] All acceptance criteria met, screenshots light/dark/phone reviewed, ready for PR

## Dependency graph
```
006 migration (exists) ──► T1 bootstrap tolerance ──► (deploy)
                     └──► T3 relax check ──► T3 revoke UI ◄── T2 labels (same Recent-decisions list)
lib.js qr HMAC ──► T4 signed badge (server verify ► badge render ► scanner parse)
T4 ──► T5 walk-ins (same endpoint)   T4 ──► T6 president entry point (same dialog)
T7, T8, T9: independent (safe to parallelize)
```

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Migration not run before deploy (F3) | High | Task 1 first; startup log names the missing migration |
| Relaxing the DB check lets an event-less row be pending | Med | New check allows only `approved`/`rejected` for event-less grants; test both |
| Signed badges invalidate any badge already shown | Low | Feature is new; badges regenerate on open; server accepts unsigned ids for one release only if asked |
| Walk-ins overfill an event | Med | Capacity check in the same endpoint; President can override only with a reason (audit) |
| Scanner behaviour differs on iOS Safari | Med | Manual roster fallback already in dialog; test on a phone before club night |

## Open Questions (need your answer)
1. **Walk-ins (Task 5):** at the door, should an officer be able to check in someone who did not sign up? If yes, should it respect capacity?
2. **Who may grant:** Presidents and admins only (as now), or Sector Heads for their own sector too?
3. **Revoking:** should revoking a grant require a written reason (like Overrides do)? Recommended: yes.
4. **Badges:** static printable badge (recommended), or a code that refreshes every 30 s on the member's phone (stronger, but no printing)?
