-- Run once in the Supabase SQL editor (safe to run again).
-- Officer-created hours, both stored in hour_logs as approved rows:
--   * 'manual_president_grant': a President awards hours by hand; no event, so event_id is NULL
--   * 'qr_checkin': a lead or President scanned the member's badge at an event
-- Existing rows are untouched (grant_type stays NULL for normal member submissions).

alter table hour_logs alter column event_id drop not null;

alter table hour_logs add column if not exists grant_type   text;
alter table hour_logs add column if not exists granted_by   integer references users(id) on delete set null;
alter table hour_logs add column if not exists grant_reason text;
alter table hour_logs add column if not exists grant_notes  text;
alter table hour_logs add column if not exists grant_date   date;
alter table hour_logs add column if not exists grant_scope  text;  -- 'in' or 'out' school, for event-less grants

alter table hour_logs drop constraint if exists hour_logs_grant_type_check;
alter table hour_logs add constraint hour_logs_grant_type_check
  check (grant_type is null or grant_type in ('manual_president_grant', 'qr_checkin'));

alter table hour_logs drop constraint if exists hour_logs_grant_scope_check;
alter table hour_logs add constraint hour_logs_grant_scope_check
  check (grant_scope is null or grant_scope in ('in', 'out'));

-- Only a President's manual grant may have no event, and it must say why and when.
alter table hour_logs drop constraint if exists hour_logs_event_or_grant_check;
alter table hour_logs add constraint hour_logs_event_or_grant_check
  check (event_id is not null
         or (grant_type = 'manual_president_grant' and grant_reason is not null and grant_date is not null and status = 'approved'));

create index if not exists idx_hour_logs_grant on hour_logs(grant_type) where grant_type is not null;

-- Check it worked: should list the six new columns.
select column_name, data_type, is_nullable from information_schema.columns
 where table_name = 'hour_logs' and (column_name like 'grant%' or column_name = 'event_id') order by column_name;
