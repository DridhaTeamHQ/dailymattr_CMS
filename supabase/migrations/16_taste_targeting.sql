-- 16 · reader taste, targeted push, push opens
--
-- Until now a push went to every token, and the desk had no way to know who
-- actually leans toward the story's topic. The app already knows: it keeps a
-- per-topic affinity (-1..1) on the device and ranks its own feed with it. This
-- migration gives that number somewhere to land in the CMS database, next to
-- the token it belongs to, so the desk can target a push without a bridge to
-- the pipeline project and without a new secret.
--
-- Three things:
--   1. `reader_taste` — the app's own per-topic affinity, reported by the app.
--      Same number the feed ranks on, so "leans toward Sports" here means the
--      same thing it means on the phone.
--   2. `app_push_audience(topic, include_new, threshold)` — the audience for a
--      story, by rule. Positive lean in; unknown in (new readers are not left
--      out of the news for being new); negative lean out; opted-out out.
--   3. `push_open` — a content event the app sends when a notification is
--      tapped, so the push report can show opens, not just sends.
--
-- Apply after 15_push.sql. Nothing here touches DB A.

begin;

-- ── 1. what the app reports ────────────────────────────────────────────────

create table if not exists public.reader_taste (
  device_id  text not null check (length(device_id) between 8 and 64),
  -- The category *name* as the app carries it on Article.topic ("Politics"),
  -- because that is the string the app's affinity map is keyed by. The
  -- composer looks the name up from categories.slug before asking.
  topic      text not null check (length(topic) between 1 and 40),
  affinity   real not null check (affinity between -1 and 1),
  updated_at timestamptz not null default now(),
  primary key (device_id, topic)
);

create index if not exists reader_taste_topic_idx
  on public.reader_taste (topic, affinity);

alter table public.reader_taste enable row level security;

drop policy if exists taste_read_desk on public.reader_taste;
create policy taste_read_desk on public.reader_taste
  for select to authenticated
  using (private.auth_role() in ('super_admin', 'chief_editor'));

/* When this reader usually reads, in the app's four bands
   (0 morning, 1 afternoon, 2 evening, 3 night), and whether they have the
   notification switch on. Both live on the token row because both are about
   whether and when a push should reach that phone. */
alter table public.push_tokens
  add column if not exists usual_band smallint check (usual_band between 0 and 3),
  add column if not exists notify boolean not null default true;

/* The app's way in. Replaces the device's whole taste map each time rather
   than merging: a topic the app no longer reports has decayed out on the
   phone, and should not linger here as a stale lean. */
create or replace function public.app_report_taste(
  p_device text,
  p_topics jsonb,
  p_band   integer default null
) returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_n int;
begin
  if length(coalesce(p_device, '')) not between 8 and 64 then
    raise exception 'bad device id';
  end if;
  if p_topics is null or jsonb_typeof(p_topics) <> 'object' then
    raise exception 'topics must be an object of topic → affinity';
  end if;
  select count(*) into v_n from jsonb_object_keys(p_topics);
  if v_n > 32 then
    raise exception 'too many topics';
  end if;

  delete from public.reader_taste
  where device_id = p_device
    and topic not in (select jsonb_object_keys(p_topics));

  insert into public.reader_taste (device_id, topic, affinity)
  select p_device,
         left(k, 40),
         greatest(-1, least(1, (v)::real))
  from jsonb_each_text(p_topics) as t(k, v)
  where length(btrim(k)) > 0
    and v ~ '^-?[0-9]+(\.[0-9]+)?$'
  on conflict (device_id, topic) do update
    set affinity = excluded.affinity,
        updated_at = now();

  if p_band is not null and p_band between 0 and 3 then
    update public.push_tokens
      set usual_band = p_band
    where device_id = p_device;
  end if;
end;
$$;

/* The reader's switch, honoured at the source. The app calls this when the
   reader turns notifications off; the token stays so turning them back on is
   instant, but no audience query returns it. */
create or replace function public.app_set_push_enabled(
  p_device text,
  p_on     boolean
) returns void
language sql
security definer
set search_path to ''
as $$
  update public.push_tokens
    set notify = coalesce(p_on, true),
        updated_at = now()
  where device_id = p_device
    and length(coalesce(p_device, '')) between 8 and 64;
$$;

-- ── 2. the desk's way out, by rule ─────────────────────────────────────────

/* The zero-argument version from migration 15 is replaced, not overloaded:
   two functions of the same name with different arity would let a caller
   that passes nothing silently get "everyone" when it meant a topic. */
drop function if exists public.app_push_audience();

create or replace function public.app_push_audience(
  p_topic       text    default null,
  p_include_new boolean default true,
  p_threshold   real    default 0.15
) returns table (token text, device_id text, usual_band smallint)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if coalesce(private.auth_role()::text, '') not in ('super_admin', 'chief_editor') then
    raise exception 'not allowed to notify readers';
  end if;

  return query
  select t.token, t.device_id, t.usual_band
  from public.push_tokens t
  left join public.reader_taste r
    on r.device_id = t.device_id and r.topic = p_topic
  where t.notify
    and (
      p_topic is null
      or r.affinity >= p_threshold
      or (r.affinity is null and p_include_new)
    );
end;
$$;

/* What the composer shows before anyone presses send. Safe for the whole
   desk: counts, never tokens. */
create or replace function public.app_push_audience_preview(
  p_topic     text,
  p_threshold real default 0.15
) returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when private.auth_role() in ('super_admin', 'chief_editor', 'writer', 'qa') then (
      with base as (
        select t.device_id, t.notify, r.affinity
        from public.push_tokens t
        left join public.reader_taste r
          on r.device_id = t.device_id and r.topic = p_topic
      )
      select jsonb_build_object(
        'total',     (select count(*) from base),
        'off',       (select count(*) from base where not notify),
        'positive',  (select count(*) from base where notify and affinity >= p_threshold),
        'unknown',   (select count(*) from base where notify and affinity is null),
        'excluded',  (select count(*) from base where notify and affinity < p_threshold)
      )
    )
    else '{}'::jsonb
  end;
$$;

/* Audience size now means "reachable": readers who turned the switch off are
   not an audience, however many tokens they hold. */
create or replace function public.app_push_audience_size()
returns integer
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when private.auth_role() in ('super_admin', 'chief_editor', 'writer', 'qa')
      then (select count(*)::int from public.push_tokens where notify)
    else 0
  end;
$$;

/* What the desk sees on the analytics page: one row per topic. */
create or replace view public.reader_taste_summary
with (security_invoker = true) as
select
  topic,
  count(*)                                        as devices,
  count(*) filter (where affinity >= 0.15)        as positive,
  count(*) filter (where affinity < 0)            as negative,
  round(avg(affinity)::numeric, 3)                as mean_affinity,
  max(updated_at)                                 as last_at
from public.reader_taste
group by topic;

revoke all on public.reader_taste_summary from anon, authenticated;
grant select on public.reader_taste_summary to authenticated;

-- ── the record of what was sent, now with the rule ─────────────────────────

alter table public.content_notifications
  add column if not exists topic         text,
  add column if not exists audience_rule text not null default 'all'
    check (audience_rule in ('all', 'topic'));

drop function if exists public.app_record_notification(text, uuid, text, integer);

create or replace function public.app_record_notification(
  p_source     text,
  p_content    uuid,
  p_title      text,
  p_recipients integer,
  p_topic      text default null,
  p_rule       text default 'all'
) returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if coalesce(private.auth_role()::text, '') not in ('super_admin', 'chief_editor') then
    raise exception 'not allowed to notify readers';
  end if;
  if p_source not in ('cms', 'pipeline') then
    raise exception 'unknown source %', p_source;
  end if;
  if coalesce(p_rule, 'all') not in ('all', 'topic') then
    raise exception 'unknown audience rule %', p_rule;
  end if;

  insert into public.content_notifications
    (source, content_id, title, sent_by, recipients, topic, audience_rule)
  values
    (p_source, p_content, p_title, (select auth.uid()),
     greatest(0, coalesce(p_recipients, 0)),
     nullif(btrim(coalesce(p_topic, '')), ''),
     coalesce(p_rule, 'all'));
end;
$$;

-- ── 3. the open, so a push has a result ────────────────────────────────────

alter table public.content_events drop constraint if exists content_events_kind_check;
alter table public.content_events
  add constraint content_events_kind_check
  check (kind in ('view', 'share', 'comment_open', 'open_source', 'comment', 'push_open'));

create or replace function public.app_track_content(
  p_content uuid,
  p_device  text,
  p_kind    text,
  p_source  text default 'cms'
) returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_kind not in ('view', 'share', 'comment_open', 'open_source', 'comment', 'push_open') then
    raise exception 'unknown event %', p_kind;
  end if;
  if p_source not in ('cms', 'pipeline') then
    raise exception 'unknown source %', p_source;
  end if;
  if length(coalesce(p_device, '')) not between 8 and 64 then
    raise exception 'bad device id';
  end if;

  if not private.engageable(p_content, p_source) then
    return;
  end if;

  insert into public.content_events (source, content_id, device_id, kind)
  values (p_source, p_content, p_device, p_kind);
end;
$$;

/* Same view as migration 12 left it, plus push_opens. Recreated whole
   because a view cannot grow a column in place. */
create or replace view public.content_stats
with (security_invoker = true) as
with keys as (
  select source, content_id from public.content_reactions
  union
  select source, content_id from public.content_events
)
select
  k.source,
  k.content_id,
  coalesce(r.likes, 0)         as likes,
  coalesce(r.dislikes, 0)      as dislikes,
  coalesce(r.saves, 0)         as saves,
  coalesce(e.shares, 0)        as shares,
  coalesce(e.views, 0)         as views,
  coalesce(e.comment_opens, 0) as comment_opens,
  greatest(r.last_at, e.last_at) as last_at,
  coalesce(e.comments, 0)      as comments,
  coalesce(e.source_opens, 0)  as source_opens,
  coalesce(e.push_opens, 0)    as push_opens
from keys k
left join lateral (
  select
    count(*) filter (where kind = 'like')    as likes,
    count(*) filter (where kind = 'dislike') as dislikes,
    count(*) filter (where kind = 'save')    as saves,
    max(created_at)                          as last_at
  from public.content_reactions
  where source = k.source and content_id = k.content_id
) r on true
left join lateral (
  select
    count(*) filter (where kind = 'share')        as shares,
    count(*) filter (where kind = 'view')         as views,
    count(*) filter (where kind = 'comment_open') as comment_opens,
    count(*) filter (where kind = 'comment')      as comments,
    count(*) filter (where kind = 'open_source')  as source_opens,
    count(*) filter (where kind = 'push_open')    as push_opens,
    max(created_at)                               as last_at
  from public.content_events
  where source = k.source and content_id = k.content_id
) e on true;

revoke all on public.content_stats from anon, authenticated;
grant select on public.content_stats to authenticated;

-- ── grants ─────────────────────────────────────────────────────────────────
--
-- Named explicitly, as in 15: Supabase grants execute to everyone by default
-- and `revoke from public` does not undo an explicit grant.

revoke all on function public.app_report_taste(text, jsonb, integer) from public;
revoke all on function public.app_set_push_enabled(text, boolean) from public;
revoke all on function public.app_push_audience(text, boolean, real) from public, anon;
revoke all on function public.app_push_audience_preview(text, real) from public, anon;
revoke all on function public.app_push_audience_size() from public, anon;
revoke all on function public.app_record_notification(text, uuid, text, integer, text, text) from public, anon;
revoke all on function public.app_track_content(uuid, text, text, text) from public;

grant execute on function public.app_report_taste(text, jsonb, integer) to anon, authenticated;
grant execute on function public.app_set_push_enabled(text, boolean) to anon, authenticated;
grant execute on function public.app_push_audience(text, boolean, real) to authenticated;
grant execute on function public.app_push_audience_preview(text, real) to authenticated;
grant execute on function public.app_push_audience_size() to authenticated;
grant execute on function public.app_record_notification(text, uuid, text, integer, text, text) to authenticated;
grant execute on function public.app_track_content(uuid, text, text, text) to anon, authenticated;

commit;
