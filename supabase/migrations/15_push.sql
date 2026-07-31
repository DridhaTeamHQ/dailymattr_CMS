-- 15 · push notifications
--
-- Nothing ever popped up, and nothing could: the APK carried no FCM
-- credentials, so `getExpoPushTokenAsync()` threw and the app swallowed it.
-- That is fixed outside the database (a Firebase service account uploaded to
-- EAS). This is the half that lives here.
--
-- Tokens already register into DB A via `app_register_push`. But the thing that
-- knows a story was featured is the Studio, which lives in this project and has
-- no service-role access to DB A — so rather than bridge two projects with a
-- new secret, tokens register here as well. DB A keeps working untouched.

begin;

create table if not exists public.push_tokens (
  device_id  text primary key check (length(device_id) between 8 and 64),
  token      text not null,
  platform   text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);

/* One row per device, not per registration. Expo reissues a token on
   reinstall and after some updates, so a device that registers twice must
   replace its old token rather than leave a dead one behind — a stale token
   is a wasted send and, in bulk, a reason for Expo to rate-limit us. */

-- ── who may read ───────────────────────────────────────────────────────────
--
-- Nobody, in effect. A push token is a direct line to someone's phone; there is
-- no reason for it to leave the database, so there is no read policy at all and
-- the desk reaches the audience only through the function below, which returns
-- tokens for sending and never for browsing.
alter table public.push_tokens enable row level security;

-- ── what was already sent ──────────────────────────────────────────────────
create table if not exists public.content_notifications (
  id         bigint generated always as identity primary key,
  source     text not null check (source in ('cms', 'pipeline')),
  content_id uuid not null,
  title      text not null,
  sent_by    uuid references auth.users(id),
  sent_at    timestamptz not null default now(),
  recipients integer not null default 0,
  -- A push cannot be recalled, so the guard against sending one twice is a
  -- constraint rather than a check in the UI.
  unique (source, content_id)
);

alter table public.content_notifications enable row level security;

drop policy if exists notifications_read_desk on public.content_notifications;
create policy notifications_read_desk on public.content_notifications
  for select to authenticated
  using (private.auth_role() in ('super_admin', 'chief_editor', 'writer', 'qa'));

-- ── the app's way in ───────────────────────────────────────────────────────
create or replace function public.app_register_push_token(
  p_device   text,
  p_token    text,
  p_platform text
) returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if length(coalesce(p_device, '')) not between 8 and 64 then
    raise exception 'bad device id';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'unknown platform %', p_platform;
  end if;
  -- ExponentPushToken[…] or ExpoPushToken[…]; anything else is not sendable
  if coalesce(p_token, '') !~ '^Expo(nent)?PushToken\[.+\]$' then
    raise exception 'not an expo push token';
  end if;

  insert into public.push_tokens (device_id, token, platform)
  values (p_device, p_token, p_platform)
  on conflict (device_id) do update
    set token = excluded.token,
        platform = excluded.platform,
        updated_at = now();
end;
$$;

-- ── the desk's way out ─────────────────────────────────────────────────────
--
-- Returns tokens to send to, and refuses anyone who is not allowed to
-- broadcast. The check is here rather than in the route because the route runs
-- with whatever session the browser hands it — the database is the only place
-- that can be sure.
create or replace function public.app_push_audience()
returns table (token text)
language plpgsql
security definer
set search_path to ''
as $$
begin
  -- coalesce, because auth_role() is NULL for anyone who is not desk staff
  -- and `NULL not in (...)` evaluates to NULL rather than true — without
  -- it the guard never fires and an anonymous caller gets every token.
  if coalesce(private.auth_role()::text, '') not in ('super_admin', 'chief_editor') then
    raise exception 'not allowed to notify readers';
  end if;
  return query select t.token from public.push_tokens t;
end;
$$;

/** How many phones a broadcast would reach. Safe for any desk role to see. */
create or replace function public.app_push_audience_size()
returns integer
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when private.auth_role() in ('super_admin', 'chief_editor', 'writer', 'qa')
      then (select count(*)::int from public.push_tokens)
    else 0
  end;
$$;

create or replace function public.app_record_notification(
  p_source     text,
  p_content    uuid,
  p_title      text,
  p_recipients integer
) returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  -- coalesce, because auth_role() is NULL for anyone who is not desk staff
  -- and `NULL not in (...)` evaluates to NULL rather than true — without
  -- it the guard never fires and an anonymous caller gets every token.
  if coalesce(private.auth_role()::text, '') not in ('super_admin', 'chief_editor') then
    raise exception 'not allowed to notify readers';
  end if;
  if p_source not in ('cms', 'pipeline') then
    raise exception 'unknown source %', p_source;
  end if;

  insert into public.content_notifications (source, content_id, title, sent_by, recipients)
  values (p_source, p_content, p_title, (select auth.uid()), greatest(0, coalesce(p_recipients, 0)));
end;
$$;

/* Named explicitly rather than revoked from PUBLIC.

   Supabase's default privileges GRANT EXECUTE on every new function in public
   to anon, authenticated and service_role. Those are explicit grants, and
   `revoke ... from public` does not remove an explicit grant — so anon kept
   execute on all of these until it was revoked by name. */
revoke all on function public.app_register_push_token(text, text, text) from public;
revoke all on function public.app_push_audience() from public, anon;
revoke all on function public.app_push_audience_size() from public, anon;
revoke all on function public.app_record_notification(text, uuid, text, integer) from public, anon;

grant execute on function public.app_register_push_token(text, text, text) to anon, authenticated;
grant execute on function public.app_push_audience() to authenticated;
grant execute on function public.app_push_audience_size() to authenticated;
grant execute on function public.app_record_notification(text, uuid, text, integer) to authenticated;

commit;
