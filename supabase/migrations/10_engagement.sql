-- 10 · engagement
--
-- Likes, dislikes, saves, shares and comment-opens for CMS content, and the
-- aggregate the Studio shows the desk.
--
-- Why this is here at all: the app's existing telemetry lives in DB A, and
-- `app_events.article_id` is a uuid with a foreign key into that project's
-- `articles` table — so a CMS id cannot go in it. Until now the app dropped
-- the row and kept only the topic (see `pipelineIdOnly` in lib/telemetry), and
-- §6 of the integration brief recorded engagement as "does not exist. No
-- table, no column, no endpoint." This is that endpoint.
--
-- Readers are anonymous. There is no account, only a device id generated on
-- first launch, so nothing here can be trusted as a count of *people* — it is
-- a count of devices, and it is presented to the desk that way.

begin;

-- ── reactions: at most one per device, per item, per kind ──────────────────
--
-- A primary key rather than a counter column. A device that likes the same
-- story twice writes the same row twice, which the key refuses, so a count is
-- a count of devices and not of taps — and un-liking is a delete, which makes
-- the toggle exactly reversible.
create table if not exists public.content_reactions (
  content_id uuid not null references public.content_items(id) on delete cascade,
  device_id  text not null check (length(device_id) between 8 and 64),
  kind       text not null check (kind in ('like', 'dislike', 'save')),
  created_at timestamptz not null default now(),
  primary key (content_id, device_id, kind)
);

create index if not exists content_reactions_item_idx
  on public.content_reactions (content_id, kind);

-- ── events: append-only, one row per occurrence ────────────────────────────
--
-- Shares and views are not toggles: the same reader sharing twice is two
-- shares, and that is the number the desk wants.
create table if not exists public.content_events (
  id         bigint generated always as identity primary key,
  content_id uuid not null references public.content_items(id) on delete cascade,
  device_id  text not null check (length(device_id) between 8 and 64),
  kind       text not null check (kind in ('view', 'share', 'comment_open', 'open_source')),
  created_at timestamptz not null default now()
);

create index if not exists content_events_item_idx
  on public.content_events (content_id, kind);
create index if not exists content_events_at_idx
  on public.content_events (created_at desc);

-- ── the numbers the Studio reads ───────────────────────────────────────────
--
-- `security_invoker` so the view is subject to the caller's policies rather
-- than the owner's: a signed-out request gets nothing, and the grant below is
-- what decides who sees it.
create or replace view public.content_stats
with (security_invoker = true) as
select
  ci.id as content_id,
  coalesce(r.likes, 0)         as likes,
  coalesce(r.dislikes, 0)      as dislikes,
  coalesce(r.saves, 0)         as saves,
  coalesce(e.shares, 0)        as shares,
  coalesce(e.views, 0)         as views,
  coalesce(e.comment_opens, 0) as comment_opens,
  greatest(r.last_at, e.last_at) as last_at
from public.content_items ci
left join lateral (
  select
    count(*) filter (where kind = 'like')    as likes,
    count(*) filter (where kind = 'dislike') as dislikes,
    count(*) filter (where kind = 'save')    as saves,
    max(created_at)                          as last_at
  from public.content_reactions where content_id = ci.id
) r on true
left join lateral (
  select
    count(*) filter (where kind = 'share')        as shares,
    count(*) filter (where kind = 'view')         as views,
    count(*) filter (where kind = 'comment_open') as comment_opens,
    max(created_at)                               as last_at
  from public.content_events where content_id = ci.id
) e on true;

-- ── who may read ───────────────────────────────────────────────────────────
--
-- Stats are for the desk, not the reader, and not every member of the desk:
-- a writer seeing live like counts on their own work is a pressure nobody
-- asked for. Super admins and chief editors only, enforced here rather than
-- by hiding a panel — the panel is a convenience, this is the boundary.
alter table public.content_reactions enable row level security;
alter table public.content_events   enable row level security;

drop policy if exists reactions_read_desk on public.content_reactions;
create policy reactions_read_desk on public.content_reactions
  for select to authenticated
  using (private.auth_role() in ('super_admin', 'chief_editor'));

drop policy if exists events_read_desk on public.content_events;
create policy events_read_desk on public.content_events
  for select to authenticated
  using (private.auth_role() in ('super_admin', 'chief_editor'));

-- No insert policy for anon on purpose. Writes go through the two functions
-- below, which are the only path in and can validate what they are given.

revoke all on public.content_stats from anon, authenticated;
grant select on public.content_stats to authenticated;

-- ── the app's way in ───────────────────────────────────────────────────────

-- Toggle a reaction. `p_on = false` removes it, so the client sends the state
-- it wants rather than "flip whatever is there" — a retried request then lands
-- on the same answer instead of undoing itself.
create or replace function public.app_react(
  p_content uuid,
  p_device  text,
  p_kind    text,
  p_on      boolean
) returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_kind not in ('like', 'dislike', 'save') then
    raise exception 'unknown reaction %', p_kind;
  end if;
  if length(coalesce(p_device, '')) not between 8 and 64 then
    raise exception 'bad device id';
  end if;

  -- Only published content can be reacted to: a draft has no readers, so a
  -- reaction on one arrived by some route that should not exist.
  if not exists (
    select 1 from public.content_items
    where id = p_content and status = 'published'
  ) then
    return;
  end if;

  if p_on then
    insert into public.content_reactions (content_id, device_id, kind)
    values (p_content, p_device, p_kind)
    on conflict do nothing;

    -- like and dislike are opposites; holding both is not a state the UI can
    -- produce, so it is not one the table should hold either
    if p_kind in ('like', 'dislike') then
      delete from public.content_reactions
      where content_id = p_content
        and device_id = p_device
        and kind = case when p_kind = 'like' then 'dislike' else 'like' end;
    end if;
  else
    delete from public.content_reactions
    where content_id = p_content and device_id = p_device and kind = p_kind;
  end if;
end;
$$;

-- Record something that happened. Append-only.
create or replace function public.app_track_content(
  p_content uuid,
  p_device  text,
  p_kind    text
) returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_kind not in ('view', 'share', 'comment_open', 'open_source') then
    raise exception 'unknown event %', p_kind;
  end if;
  if length(coalesce(p_device, '')) not between 8 and 64 then
    raise exception 'bad device id';
  end if;

  if not exists (
    select 1 from public.content_items
    where id = p_content and status = 'published'
  ) then
    return;
  end if;

  insert into public.content_events (content_id, device_id, kind)
  values (p_content, p_device, p_kind);
end;
$$;

revoke all on function public.app_react(uuid, text, text, boolean) from public;
revoke all on function public.app_track_content(uuid, text, text) from public;
grant execute on function public.app_react(uuid, text, text, boolean) to anon, authenticated;
grant execute on function public.app_track_content(uuid, text, text) to anon, authenticated;

commit;
