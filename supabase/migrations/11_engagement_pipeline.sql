-- 11 · engagement, pipeline articles included
--
-- Migration 10 keyed engagement to `content_items` with a foreign key, which
-- meant it could only ever count Pix, Qix, Trax and desk-written articles. The
-- bulk of what readers actually see is NewsStudio articles, and those live in a
-- different Supabase project entirely — so their id cannot satisfy that key and
-- every like on them was discarded before it left the phone.
--
-- The fix is to stop pretending one project's primary key can police another's.
-- `content_id` becomes a plain uuid, and a `source` column says which world it
-- came from. Referential integrity for pipeline rows is the price: deleting an
-- article upstream now leaves counts behind. That is a tidiness problem, and it
-- is worth less than counting the majority of the feed.
--
-- What is NOT given up is the "only real content" check. `article_selections`
-- lives in this project and holds exactly the articles the desk approved into
-- the app — so it is the pipeline's equivalent of `status = 'published'`, and
-- the functions below check it. An id nobody approved still writes nothing.

begin;

-- ── keys that span two projects ────────────────────────────────────────────

alter table public.content_reactions
  drop constraint if exists content_reactions_content_id_fkey;
alter table public.content_events
  drop constraint if exists content_events_content_id_fkey;

-- No default on purpose. Every write comes from the two functions below, and
-- both pass it explicitly; a default would let a future caller omit it and have
-- pipeline engagement quietly filed as CMS engagement.
alter table public.content_reactions
  add column if not exists source text not null
  check (source in ('cms', 'pipeline'));
alter table public.content_events
  add column if not exists source text not null
  check (source in ('cms', 'pipeline'));

-- The identity of a reaction now includes which project the id belongs to.
alter table public.content_reactions
  drop constraint if exists content_reactions_pkey;
alter table public.content_reactions
  add primary key (source, content_id, device_id, kind);

drop index if exists public.content_reactions_item_idx;
drop index if exists public.content_events_item_idx;
create index if not exists content_reactions_item_idx
  on public.content_reactions (source, content_id, kind);
create index if not exists content_events_item_idx
  on public.content_events (source, content_id, kind);

-- ── the numbers, now for both worlds ───────────────────────────────────────
--
-- Dropped rather than replaced: `source` belongs at the front of the key, and
-- `create or replace view` can only append columns.
--
-- No longer anchored to `content_items`, because half of what it counts is not
-- in that table. An item nobody has touched simply has no row — the Studio
-- renders a missing row as zeros, which is the same answer with less to carry.
drop view if exists public.content_stats;

create view public.content_stats
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
  greatest(r.last_at, e.last_at) as last_at
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
    max(created_at)                               as last_at
  from public.content_events
  where source = k.source and content_id = k.content_id
) e on true;

revoke all on public.content_stats from anon, authenticated;
grant select on public.content_stats to authenticated;

-- ── the app's way in ───────────────────────────────────────────────────────
--
-- Dropped and recreated rather than replaced: adding a parameter makes a new
-- signature, and leaving the old four-argument version in place would give
-- PostgREST two candidates for the same call and an ambiguity error.

drop function if exists public.app_react(uuid, text, text, boolean);
drop function if exists public.app_track_content(uuid, text, text);

-- True when this id is something a reader could actually have been shown.
create or replace function private.engageable(p_content uuid, p_source text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case p_source
    when 'cms' then exists (
      select 1 from public.content_items
      where id = p_content and status = 'published'
    )
    -- `article_selections.article_id` is text holding a uuid; compare as text
    -- so a malformed row upstream cannot raise instead of simply not matching.
    when 'pipeline' then exists (
      select 1 from public.article_selections
      where article_id = p_content::text
    )
    else false
  end
$$;

create or replace function public.app_react(
  p_content uuid,
  p_device  text,
  p_kind    text,
  p_on      boolean,
  p_source  text default 'cms'
) returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_kind not in ('like', 'dislike', 'save') then
    raise exception 'unknown reaction %', p_kind;
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

  if p_on then
    insert into public.content_reactions (source, content_id, device_id, kind)
    values (p_source, p_content, p_device, p_kind)
    on conflict do nothing;

    if p_kind in ('like', 'dislike') then
      delete from public.content_reactions
      where source = p_source
        and content_id = p_content
        and device_id = p_device
        and kind = case when p_kind = 'like' then 'dislike' else 'like' end;
    end if;
  else
    delete from public.content_reactions
    where source = p_source
      and content_id = p_content
      and device_id = p_device
      and kind = p_kind;
  end if;
end;
$$;

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
  if p_kind not in ('view', 'share', 'comment_open', 'open_source') then
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

revoke all on function private.engageable(uuid, text) from public;
revoke all on function public.app_react(uuid, text, text, boolean, text) from public;
revoke all on function public.app_track_content(uuid, text, text, text) from public;
grant execute on function public.app_react(uuid, text, text, boolean, text) to anon, authenticated;
grant execute on function public.app_track_content(uuid, text, text, text) to anon, authenticated;

commit;
