-- Permission tests for the CMS database.
--
-- Run in the Supabase SQL editor. Everything happens inside a transaction that
-- rolls back, so it changes nothing.
--
-- Read the results as:
--   ALLOWED (n rows)  the action went through and had an effect
--   BLOCKED (...)     a policy or trigger refused it, with the reason
--   NO-OP (0 rows)    RLS filtered the row out before the update ran
--
-- The NO-OP case is why this harness counts rows. An UPDATE that RLS filters
-- to zero rows raises nothing and returns success, so a test that only checks
-- for an absence of errors reports a blocked action as permitted — which is
-- exactly the wrong way round for a security test.

create or replace function pg_temp.try(stmt text) returns text language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return case when n > 0 then 'ALLOWED (' || n || ' row)' else 'NO-OP (0 rows — RLS filtered)' end;
exception when others then
  return 'BLOCKED (' || left(replace(SQLERRM, E'\n', ' '), 58) || ')';
end $$;

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

begin;

insert into content_items (id, kind, title, slug, summary, body, status, created_by, language)
values ('aaaaaaaa-0000-4000-8000-00000000ffff', 'pix', 'RLS probe', 'rls-probe-tmp',
        'x', '{}', 'draft', '33333333-3333-4333-8333-333333333333', 'en');

select * from (values
  -- Privilege escalation. These must all be BLOCKED or NO-OP.
  ('writer: promote self to super_admin',
   pg_temp.as_user('33333333-3333-4333-8333-333333333333')::text,
   pg_temp.try($$update cms_users set role='super_admin' where id='33333333-3333-4333-8333-333333333333'$$)),
  ('writer: deactivate own account',
   pg_temp.as_user('33333333-3333-4333-8333-333333333333')::text,
   pg_temp.try($$update cms_users set is_active=false where id='33333333-3333-4333-8333-333333333333'$$)),
  ('writer: change own email',
   pg_temp.as_user('33333333-3333-4333-8333-333333333333')::text,
   pg_temp.try($$update cms_users set email='attacker@evil.test' where id='33333333-3333-4333-8333-333333333333'$$)),
  ('qa: promote another user',
   pg_temp.as_user('44444444-4444-4444-8444-444444444444')::text,
   pg_temp.try($$update cms_users set role='super_admin' where id='33333333-3333-4333-8333-333333333333'$$)),
  ('writer: delete another user',
   pg_temp.as_user('33333333-3333-4333-8333-333333333333')::text,
   pg_temp.try($$delete from cms_users where id='44444444-4444-4444-8444-444444444444'$$)),
  ('writer: publish own draft',
   pg_temp.as_user('33333333-3333-4333-8333-333333333333')::text,
   pg_temp.try($$update content_items set status='published' where id='aaaaaaaa-0000-4000-8000-00000000ffff'$$)),
  ('qa: publish',
   pg_temp.as_user('44444444-4444-4444-8444-444444444444')::text,
   pg_temp.try($$update content_items set status='published' where id='aaaaaaaa-0000-4000-8000-00000000ffff'$$)),

  -- Legitimate work. These must all be ALLOWED, or the CMS is broken.
  ('writer: rename self',
   pg_temp.as_user('33333333-3333-4333-8333-333333333333')::text,
   pg_temp.try($$update cms_users set full_name='Renamed' where id='33333333-3333-4333-8333-333333333333'$$)),
  ('qa: move a draft into review',
   pg_temp.as_user('44444444-4444-4444-8444-444444444444')::text,
   pg_temp.try($$update content_items set status='in_review' where id='aaaaaaaa-0000-4000-8000-00000000ffff'$$)),
  ('chief editor: publish',
   pg_temp.as_user('22222222-2222-4222-8222-222222222222')::text,
   pg_temp.try($$update content_items set status='published' where id='aaaaaaaa-0000-4000-8000-00000000ffff'$$)),
  ('admin: change a role',
   pg_temp.as_user('11111111-1111-4111-8111-111111111111')::text,
   pg_temp.try($$update cms_users set role='qa' where id='33333333-3333-4333-8333-333333333333'$$)),
  ('admin: deactivate a user',
   pg_temp.as_user('11111111-1111-4111-8111-111111111111')::text,
   pg_temp.try($$update cms_users set is_active=false where id='33333333-3333-4333-8333-333333333333'$$))
) as t(test, _ctx, result);

rollback;
