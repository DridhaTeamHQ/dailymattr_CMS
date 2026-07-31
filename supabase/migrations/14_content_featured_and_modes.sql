-- 14 · featured CMS content, and somewhere to put reading modes
--
-- `is_featured` existed only on `article_selections`, which describes pipeline
-- articles. So a Pix, Qix, Trax or desk-written story could not be featured at
-- all — the app hardcoded `featured: false` for every one of them, and the flag
-- the Studio showed had no counterpart for its own content.
--
-- The second column is groundwork for reading modes. Pipeline stories keep
-- theirs in `articles.versions` in DB A, which the CMS never writes; overrides
-- therefore live here beside `title_override` / `summary_override` /
-- `image_override`, which exist for exactly the same reason.

begin;

alter table public.content_items
  add column if not exists is_featured boolean not null default false;

/* Partial: the desk features a handful of stories out of thousands, so an
   index over every row would be mostly dead weight. */
create index if not exists content_items_featured_idx
  on public.content_items (is_featured)
  where is_featured;

alter table public.article_selections
  add column if not exists modes_override jsonb;

comment on column public.content_items.is_featured is
  'Editorial lead flag for CMS-authored content. The pipeline equivalent lives on article_selections.is_featured; both surface in the app as a Featured badge and a lead position.';

comment on column public.article_selections.modes_override is
  'Reading modes written by the desk for a pipeline story: {eli5, tldr[], keyNumbers[]}. DB A owns articles.versions and the CMS never writes it, so overrides live here beside title_override/summary_override/image_override.';

commit;
