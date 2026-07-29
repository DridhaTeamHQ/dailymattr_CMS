-- 12 · engagement, comments counted
--
-- The strip showed a speech bubble that counted `comment_open` — the panel
-- being opened, not anything being said. A story someone actually commented on
-- read as zero, which is worse than showing nothing: it looked like an answer.
--
-- Comments themselves live in DB A, written through `app_add_comment`, and
-- there is no join between the two projects. So the app reports the act rather
-- than the CMS counting the rows: one event per comment successfully posted.
--
-- Both numbers are kept. Opens over comments is the more useful of the two —
-- it says how many people looked at the conversation versus joined it — and
-- throwing the denominator away to fix the numerator would be a poor trade.

begin;

alter table public.content_events
  drop constraint if exists content_events_kind_check;
alter table public.content_events
  add constraint content_events_kind_check
  check (kind in ('view', 'share', 'comment_open', 'open_source', 'comment'));

-- Replaced rather than dropped, which is why the two new columns are appended
-- instead of slotted in beside the counts they belong with: `create or replace
-- view` may only add columns at the end. Worth the untidy order — dropping the
-- view would drop its grant with it, and a re-grant that gets forgotten is a
-- Studio that silently shows nothing.
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
  coalesce(e.source_opens, 0)  as source_opens
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
    max(created_at)                               as last_at
  from public.content_events
  where source = k.source and content_id = k.content_id
) e on true;

-- No re-grant needed: `create or replace` kept the one migration 11 set.

-- `app_track_content` validates the kind itself, so it has to learn the new one
-- too — the table constraint alone would turn a typo into a 500 rather than the
-- 400 the app already knows how to swallow.
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
  if p_kind not in ('view', 'share', 'comment_open', 'open_source', 'comment') then
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

commit;
