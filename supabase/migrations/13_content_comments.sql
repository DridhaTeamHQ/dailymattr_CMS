-- 13 · comments on the desk's own content
--
-- Readers could not comment on a Pix, a Qix, a Trax or an article written
-- here, and nothing said so. `app_comments.article_id` in DB A is a uuid keyed
-- to the pipeline's `articles` table, so a CMS id cannot go in it — the app's
-- `commentsSupported` refused those ids outright, `fetchComments` returned an
-- empty list, and the panel showed "No comments yet".
--
-- Which is an invitation. You type, you press send, and `addComment` throws —
-- and the mutation had no error handler, so nothing appeared, nothing saved,
-- and the comment was simply gone. After the cutover most of the feed is CMS
-- content, so most comments went nowhere.
--
-- This is the other half of `app_comments`, living in the project that owns the
-- content it hangs off. Deliberately the same row shape and the same function
-- signatures, so the app maps both with one set of types and picks a database
-- by looking at the id.

begin;

create table if not exists public.content_comments (
  id         uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  parent_id  uuid references public.content_comments(id) on delete cascade,
  device_id  text not null check (length(device_id) between 8 and 64),
  body       text not null check (length(btrim(body)) between 1 and 600),
  created_at timestamptz not null default now()
);

-- A foreign key here, unlike the engagement tables: this content lives in this
-- project, so deleting it should take its thread with it rather than leaving
-- comments attached to nothing.
create index if not exists content_comments_item_idx
  on public.content_comments (content_id, created_at);
create index if not exists content_comments_parent_idx
  on public.content_comments (parent_id);

create table if not exists public.content_comment_likes (
  comment_id uuid not null references public.content_comments(id) on delete cascade,
  device_id  text not null check (length(device_id) between 8 and 64),
  created_at timestamptz not null default now(),
  primary key (comment_id, device_id)
);

-- ── who may read ───────────────────────────────────────────────────────────
--
-- Comments are public: every reader sees the thread, which is the point of a
-- thread. Writes still go through the functions below, so "public" means
-- readable, not writable.
alter table public.content_comments      enable row level security;
alter table public.content_comment_likes enable row level security;

drop policy if exists content_comments_read on public.content_comments;
create policy content_comments_read on public.content_comments
  for select to anon, authenticated using (true);

drop policy if exists content_comment_likes_read on public.content_comment_likes;
create policy content_comment_likes_read on public.content_comment_likes
  for select to anon, authenticated using (true);

-- ── the app's way in ───────────────────────────────────────────────────────

-- Same columns and order as DB A's `app_comments_for`, so lib/comments can
-- shape either result with the same mapper.
create or replace function public.app_content_comments_for(
  p_content uuid,
  p_device  text,
  p_limit   integer default 120
) returns table (
  id uuid,
  parent_id uuid,
  device_id text,
  body text,
  created_at timestamptz,
  like_count integer,
  liked_by_me boolean,
  reply_count integer
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    c.id,
    c.parent_id,
    c.device_id,
    c.body,
    c.created_at,
    (select count(*)::int from public.content_comment_likes l where l.comment_id = c.id),
    exists (
      select 1 from public.content_comment_likes l
      where l.comment_id = c.id and l.device_id = p_device
    ),
    (select count(*)::int from public.content_comments r where r.parent_id = c.id)
  from public.content_comments c
  where c.content_id = p_content
  order by c.created_at
  limit greatest(1, least(coalesce(p_limit, 120), 500));
$$;

create or replace function public.app_add_content_comment(
  p_device  text,
  p_content uuid,
  p_body    text,
  p_parent  uuid default null
) returns table (
  id uuid,
  parent_id uuid,
  device_id text,
  body text,
  created_at timestamptz,
  like_count integer,
  liked_by_me boolean,
  reply_count integer
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
begin
  if length(coalesce(p_device, '')) not between 8 and 64 then
    raise exception 'bad device id';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'empty comment';
  end if;

  -- Only published content has readers. A comment on anything else arrived by
  -- a route that should not exist.
  if not exists (
    select 1 from public.content_items
    where id = p_content and status = 'published'
  ) then
    raise exception 'story is not available for comments';
  end if;

  -- A reply must belong to the same story, or a thread could be grafted onto
  -- another one by passing someone else's comment id.
  if p_parent is not null and not exists (
    select 1 from public.content_comments
    where id = p_parent and content_id = p_content
  ) then
    raise exception 'reply target is not on this story';
  end if;

  insert into public.content_comments (content_id, parent_id, device_id, body)
  values (p_content, p_parent, p_device, btrim(p_body))
  returning public.content_comments.id into v_id;

  return query
    select c.id, c.parent_id, c.device_id, c.body, c.created_at,
           0, false, 0
    from public.content_comments c
    where c.id = v_id;
end;
$$;

create or replace function public.app_toggle_content_comment_like(
  p_device  text,
  p_comment uuid
) returns table (liked boolean, like_count integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_liked boolean;
begin
  if length(coalesce(p_device, '')) not between 8 and 64 then
    raise exception 'bad device id';
  end if;

  if exists (
    select 1 from public.content_comment_likes
    where comment_id = p_comment and device_id = p_device
  ) then
    delete from public.content_comment_likes
    where comment_id = p_comment and device_id = p_device;
    v_liked := false;
  else
    insert into public.content_comment_likes (comment_id, device_id)
    values (p_comment, p_device)
    on conflict do nothing;
    v_liked := true;
  end if;

  return query
    select v_liked,
           (select count(*)::int from public.content_comment_likes l
             where l.comment_id = p_comment);
end;
$$;

-- What the Studio reads, mirroring DB A's `app_comment_counts`.
create or replace function public.app_content_comment_counts(
  p_ids uuid[]
) returns table (content_id uuid, n bigint)
language sql
stable
security definer
set search_path to ''
as $$
  select c.content_id, count(*)
  from public.content_comments c
  where c.content_id = any(p_ids)
  group by c.content_id;
$$;

revoke all on function public.app_content_comments_for(uuid, text, integer) from public;
revoke all on function public.app_add_content_comment(text, uuid, text, uuid) from public;
revoke all on function public.app_toggle_content_comment_like(text, uuid) from public;
revoke all on function public.app_content_comment_counts(uuid[]) from public;

grant execute on function public.app_content_comments_for(uuid, text, integer) to anon, authenticated;
grant execute on function public.app_add_content_comment(text, uuid, text, uuid) to anon, authenticated;
grant execute on function public.app_toggle_content_comment_like(text, uuid) to anon, authenticated;
grant execute on function public.app_content_comment_counts(uuid[]) to anon, authenticated;

commit;
