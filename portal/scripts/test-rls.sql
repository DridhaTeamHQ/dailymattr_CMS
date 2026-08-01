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
   pg_temp.try($$update cms_users set is_active=false where id='33333333-3333-4333-8333-333333333333'$$)),
  ('writer: change own id',
   pg_temp.as_user('33333333-3333-4333-8333-333333333333')::text,
   pg_temp.try($$update cms_users set id='eeeeeeee-0000-4000-8000-00000000beef' where id='33333333-3333-4333-8333-333333333333'$$))
) as t(test, _ctx, result);

rollback;

-- ── comments can be taken down, and only by the right people ────────
--
-- The interesting result here is the writer's: RLS answers a refused delete
-- with success and zero rows, not an error. lib/db.ts checks the row count for
-- exactly that reason — a takedown that silently did not happen is the worst
-- outcome this feature has.
begin;

insert into content_items (id, kind, title, slug, summary, body, status, created_by, language)
values ('faaaaaaa-0000-4000-8000-00000000feed', 'pix', 'moderation probe', 'mod-probe',
        'x', '{}', 'published', '33333333-3333-4333-8333-333333333333', 'en');
insert into content_comments (id, content_id, device_id, body)
values ('fbbbbbbb-0000-4000-8000-00000000c001', 'faaaaaaa-0000-4000-8000-00000000feed',
        'device-abcdefgh', 'root comment');
insert into content_comments (id, parent_id, content_id, device_id, body)
values ('fbbbbbbb-0000-4000-8000-00000000c002', 'fbbbbbbb-0000-4000-8000-00000000c001',
        'faaaaaaa-0000-4000-8000-00000000feed', 'device-abcdefgh', 'a reply');

select * from (values
  ('writer: take a comment down',
   pg_temp.try($$select pg_temp.as_user('33333333-3333-4333-8333-333333333333')$$),
   pg_temp.try($$delete from content_comments where id='fbbbbbbb-0000-4000-8000-00000000c002'$$)),
  ('qa: take a comment down',
   pg_temp.try($$select pg_temp.as_user('44444444-4444-4444-8444-444444444444')$$),
   pg_temp.try($$delete from content_comments where id='fbbbbbbb-0000-4000-8000-00000000c002'$$)),
  ('chief editor: take a root down',
   pg_temp.try($$select pg_temp.as_user('22222222-2222-4222-8222-222222222222')$$),
   pg_temp.try($$delete from content_comments where id='fbbbbbbb-0000-4000-8000-00000000c001'$$)),
  ('replies went with it', '',
   pg_temp.try($$select 1 from content_comments where content_id='faaaaaaa-0000-4000-8000-00000000feed'$$)),
  ('writer: post directly, bypassing the app',
   pg_temp.try($$select pg_temp.as_user('33333333-3333-4333-8333-333333333333')$$),
   pg_temp.try($$insert into content_comments (content_id, device_id, body)
                 values ('faaaaaaa-0000-4000-8000-00000000feed','device-abcdefgh','sneak')$$))
) as t(test, _ctx, result);

rollback;

-- ── the error log reports up, never down ────────────────────────────
--
-- Anyone signed in must be able to file a report, or the failures worth having
-- are the ones lost. Nobody but an administrator may read them: a stack trace
-- describes how the software is put together.
begin;

create or replace function pg_temp.visible(uid text) returns integer language plpgsql as $$
declare c integer;
begin
  perform pg_temp.as_user(uid);
  select count(*) into c from public.client_errors;
  return c;
end $$;

insert into client_errors (actor_id, actor_email, kind, message, stack, path)
values ('33333333-3333-4333-8333-333333333333', 'writer@dailymattr.com', 'error',
        'rls probe', 'Error: rls probe at x', '/content/pix');

select * from (values
  ('writer: file a report',
   pg_temp.try($$select pg_temp.as_user('33333333-3333-4333-8333-333333333333')$$),
   pg_temp.try($$insert into client_errors (kind, message) values ('error','rls probe two')$$)),
  ('writer: rows visible',       '', 'sees ' || pg_temp.visible('33333333-3333-4333-8333-333333333333')),
  ('qa: rows visible',           '', 'sees ' || pg_temp.visible('44444444-4444-4444-8444-444444444444')),
  ('chief editor: rows visible', '', 'sees ' || pg_temp.visible('22222222-2222-4222-8222-222222222222')),
  ('admin: rows visible',        '', 'sees ' || pg_temp.visible('11111111-1111-4111-8111-111111111111')),
  ('writer: alter a report',
   pg_temp.try($$select pg_temp.as_user('33333333-3333-4333-8333-333333333333')$$),
   pg_temp.try($$update client_errors set message='tampered' where message like 'rls probe%'$$)),
  ('writer: delete a report', '',
   pg_temp.try($$delete from client_errors where message like 'rls probe%'$$)),
  ('admin: clear the log',
   pg_temp.try($$select pg_temp.as_user('11111111-1111-4111-8111-111111111111')$$),
   pg_temp.try($$delete from client_errors where message like 'rls probe%'$$))
) as t(test, _ctx, result);

rollback;

-- ── signing in adopts an invited profile ────────────────────────────
--
-- Adding someone on the Team page cannot create their Supabase Auth account, so
-- the profile exists before the login does. When the login is created, the
-- trigger has to move that profile onto the new auth id — RLS matches
-- auth.uid() against cms_users.id, so a profile left on its old id would sign
-- in with no permissions at all.
--
-- Expect: one row, id equal to the new auth id, and the invited role intact.
begin;

insert into cms_users (id, email, full_name, role, languages, states, is_active, avatar_hue)
values ('bbbbbbbb-0000-4000-8000-00000000aaaa', 'invited.probe@example.com',
        'Invited Probe', 'chief_editor', array['en'], array[]::text[], true, 200);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('bbbbbbbb-0000-4000-8000-00000000bbbb',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'invited.probe@example.com', 'x', now(), now(), now(),
        '{}'::jsonb, '{}'::jsonb);

select
  (select count(*) from cms_users where email='invited.probe@example.com') as profile_rows,
  (select id   from cms_users where email='invited.probe@example.com') = 'bbbbbbbb-0000-4000-8000-00000000bbbb' as moved_to_auth_id,
  (select role from cms_users where email='invited.probe@example.com') = 'chief_editor' as invited_role_kept;

rollback;

-- ── a signup with no invite still works ─────────────────────────────
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('cccccccc-0000-4000-8000-00000000cccc',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'fresh.probe@example.com', 'x', now(), now(), now(),
        '{}'::jsonb, '{"full_name":"Fresh Probe"}'::jsonb);

select
  (select role      from cms_users where email='fresh.probe@example.com') = 'writer' as defaults_to_writer,
  (select full_name from cms_users where email='fresh.probe@example.com') = 'Fresh Probe' as name_from_metadata,
  (select id        from cms_users where email='fresh.probe@example.com') = 'cccccccc-0000-4000-8000-00000000cccc' as id_matches_auth;

rollback;
