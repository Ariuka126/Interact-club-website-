-- Run once in the Supabase SQL editor.

-- 1) Allow the 'admin' role. (If the drop fails because the name differs, find it with:
--    select conname from pg_constraint where conrelid = 'users'::regclass and contype = 'c';)
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
  check (role in ('admin','pres','lead','member','volunteer'));

-- 2) Make yourself the first admin (register on the site first, then put your email here).
update users set role = 'admin' where lower(email) = 'your-email@example.com';

-- 3) Check it worked.
select id, name, email, role from users order by created_at;
