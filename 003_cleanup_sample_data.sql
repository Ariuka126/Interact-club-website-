-- ============================================================================
-- DESTRUCTIVE. Run once in the Supabase SQL editor, and read it first.
-- Deletes ALL hour logs and EVERY user except zuulphi@gmail.com.
-- If any real members have registered, they will be deleted too: run STEP 1 and check.
-- ============================================================================

-- STEP 1: preview who will be deleted. Run this on its own first.
select id, name, email, role, created_at
from users
where lower(email) <> 'zuulphi@gmail.com'
order by created_at;

select count(*) as hour_logs_to_delete from hour_logs;

-- STEP 2: the cleanup. All or nothing: it aborts if your admin account is missing.
begin;

do $$
begin
  if not exists (select 1 from users where lower(email) = 'zuulphi@gmail.com') then
    raise exception 'zuulphi@gmail.com not found. Aborting, nothing was deleted.';
  end if;
end $$;

update users set role = 'admin' where lower(email) = 'zuulphi@gmail.com';

truncate table hour_logs restart identity;
delete from users where lower(email) <> 'zuulphi@gmail.com';

-- Optional: also remove the 12 demo events that seed.js used to insert.
-- delete from events;

commit;

-- STEP 3: verify. Expect exactly one user (you, role admin) and zero hour logs.
select id, name, email, role from users;
select count(*) as hour_logs_left from hour_logs;

-- ----------------------------------------------------------------------------
-- OPTIONAL: check the Pending Approvals tab end to end (needs at least one event,
-- so run it only if you kept or created one). Remove the test row afterwards.
-- The approve button is blocked on your own entries, so this test uses a second
-- user; register a throwaway account first and put its email below.
--
-- insert into hour_logs (user_id, event_id, hours, work_link)
-- select u.id, (select min(id) from events), 1, 'https://example.com/proof'
-- from users u where lower(u.email) = 'throwaway@example.com';
--
-- delete from hour_logs where work_link = 'https://example.com/proof';
-- ----------------------------------------------------------------------------
