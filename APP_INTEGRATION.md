# DailyMattr — app integration brief

For the agent building the DailyMattr reader app. This describes the CMS the app
reads from: what exists today, exactly how to read it, and what does **not** exist
yet and therefore has to be built.

Read the "Status" line on each section before you rely on it. Where something is
a proposal rather than shipped, it says so — do not treat proposals as API.

---

## 1. The shape of the system

There are two Supabase projects, deliberately separate.

| | Project ref | Region | Your access |
|---|---|---|---|
| **DB B** — the CMS | `ijnlvyctwgdvsedpejva` | ap-south-1 | read (write only for engagement, see §6) |
| **DB A** — NewsStudio pipeline | `ygxdrphajvrbjcaxhvcn` | ap-southeast-2 | **read only, always** |

DB A is owned by an upstream agent pipeline that scrapes and fact-checks news. The
CMS never writes to it and neither should the app. When an editor rewrites a
pipeline story, the edit is stored as an *override* in DB B. **DB A is raw supply;
DB B is editorial truth.**

```
NewsStudio agent ──► DB A: articles ──┐
                                      ├──► the app's feed
CMS writers ──────► DB B: content_items ┘
                    DB B: article_selections  (which DB A articles are approved,
                                               plus their editorial overrides)
```

So the feed is a **merge of two sources**, not one table. §5 covers how.

### Credentials

```
DB B  NEXT_PUBLIC_SUPABASE_URL       = https://ijnlvyctwgdvsedpejva.supabase.co
      NEXT_PUBLIC_SUPABASE_ANON_KEY  = sb_publishable_9pUq4c9Yb7OgN3p4DJMMbw_T7ELat-U

DB A  NEXT_PUBLIC_NEWSSTUDIO_URL     = https://ygxdrphajvrbjcaxhvcn.supabase.co
      NEXT_PUBLIC_NEWSSTUDIO_ANON_KEY= sb_publishable_U5bF6OWzRqiZw6j8c9hQsw_s3byk-tR
```

These are publishable (anon) keys. They are designed to ship in a client bundle —
**Row Level Security is the only thing protecting the data**, so every rule you
care about must exist as a policy, not as app logic. Assume a reader can issue any
query these keys permit.

---

## 2. Reader identity

**Status: not built. You decide this, and it blocks §6.**

The CMS has `cms_users` + Supabase Auth for *staff*. There is no reader account
system. Before you can store a like you need to answer: who is "who liked this"?

Two workable options:

1. **Anonymous device identity** — generate a UUID on first launch, keep it in
   secure storage, send it as the actor. No login, works immediately, but likes
   are lost on reinstall and can be forged by anyone with the anon key.
2. **Supabase anonymous auth** — `signInAnonymously()`, upgradeable to a real
   account later. RLS can then key on `auth.uid()`, which is the only way to make
   "one like per person" actually enforceable.

**Recommendation: option 2.** Option 1 cannot be secured — with a publishable key
and no `auth.uid()`, any client can write any device id, so counts are trivially
inflatable. If you take option 1 anyway, treat all engagement numbers as
decorative and never rank on them.

---

## 3. Content model

One table, `content_items`, holds all four formats. Format-specific payload lives
in a `body` JSONB column.

### `content_items` (DB B) — columns as they exist in Postgres

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `kind` | enum | `article` \| `pix` \| `qix` \| `trax` |
| `title` | text | |
| `slug` | text | |
| `summary` | text | the card body copy |
| `body` | jsonb | format payload — see §4 |
| `category_slug` | text null | FK-ish to `categories.slug` |
| `tags` | text[] | |
| `language` | text | `en` \| `hi` \| `te` |
| `state` | text null | Indian state, for regional filtering |
| `cover_url` | text null | **may be a data: URL** — see §7 |
| `media_url` | text null | video (qix) / audio (trax) |
| `duration_sec` | int null | |
| `source_links` | jsonb | `[{ title, url }]` |
| `fact_score` | int null | 0–100 |
| `fact_label` | text null | |
| `source` | text | `cms` \| `newsstudio` |
| `source_article_id` | text null | links back to DB A when derived |
| `status` | enum | `draft`/`in_review`/`rejected`/`approved`/`published`/`archived` |
| `published_at` | timestamptz null | |
| `scheduled_at` | timestamptz null | **see gotcha in §8** |
| `created_at`, `updated_at` | timestamptz | |

Staff-only columns you should ignore: `review_note`, `created_by`, `reviewed_by`,
`published_by`.

**The app must only ever read `status = 'published'`.** Everything else is
in-progress editorial work.

### `categories` (DB B)

`slug`, `name`, `kind` (null = applies to all), `sort_order`, `is_active`.
Eight seeded: India, World, Politics, Business, Technology, Science, Sports,
Entertainment. Use `sort_order` for tab order; hide `is_active = false`.

---

## 4. The four formats

`KIND_META` in the CMS defines the reading mode for each. Match these — they are
the product's spine, not styling choices.

| Kind | Mode | What it is |
|---|---|---|
| `article` | READ | short text story |
| `pix` | LOOK | photo card + three key points |
| `qix` | WATCH | 9:16 short video |
| `trax` | LISTEN | audio explainer |

### Article

- `title` — **max 70 characters**
- `summary` — **max 300 characters**

Both are enforced in the CMS editor, and the AI writer targets them. Design the
card to these numbers and it will never clip. (Historic copy may exceed them —
clamp defensively.)

### Pix — the one with a real spec

Pix has an exact format spec in `portal/lib/pix.ts`. Every number is in points
against a **375pt reference screen**. Do not re-derive these.

```
Card surface        #0C111D  (dark in both themes)
Brand               #3979FF
Marked words        #7AA5FF dark / #6694FF light  (follows reader theme)

Headline   23pt / 28 line-height / -0.7 tracking / weight 800, max 4 lines
Key point  14pt / 21 line-height / weight 400,     max 5 lines
Publisher  12.5pt
Accent bar 34 × 3, radius 2, 12pt under the headline

List card (home feed)  width 375-48, height min(375×1.28, 520), radius 22,
                       photo occupies top 58%, copy inset 20
Page card (reader)     375 × 812, radius 0, photo 66%, copy starts 24 under photo,
                       publisher inset 22 / bottom 16
```

Content rules:

- **Exactly three key points**, stored at `body.points` as an array of 3 strings.
- Title max 96 chars (24/line × 4 lines). Each point max 220 (44 × 5).
- House style from published Pix is much tighter: **headlines ~65 chars, points
  ~72**. Aim there; the maxima are truncation backstops, not targets.
- Slide two is the three points. **The composer's prose "text slide" is not
  persisted** — it is builder-local state only. If you want a prose variant on
  slide two, render it from `body.points`, or ask for a schema change.
- `cover_url` on a Pix is the **fully composed poster** exported from the builder
  (headline, accent bar, publisher credit and badge are already burned into the
  image). Do not re-draw the headline over it — you will double it.

Marked words: the app renders certain headline words in the brand light colour —
figures, months, acronyms and proper nouns, but never the first word. The CMS
mirrors this in `lib/pixHighlight.ts`; port that rule rather than inventing one.

### Qix

- `media_url` — MP4, H.264/AAC, **9:16 vertical**, typically 720×1280 or 1080×1920
- `cover_url` — poster frame
- `duration_sec` — present; clips are short (the CMS refuses anything over 20 min)

### Trax

- `media_url` — audio
- `duration_sec` — for the scrubber
- `cover_url` — artwork

---

## 5. Building the feed

The feed is two sources merged.

### Source 1 — CMS-authored items

```sql
select * from content_items
where status = 'published'
order by published_at desc
```

### Source 2 — pipeline articles approved into the feed

`article_selections` (DB B) records which DB A articles are approved, and carries
the editorial overrides.

| Column | Notes |
|---|---|
| `article_id` | id in **DB A** `articles` |
| `is_featured` | hero slot |
| `approved_by`, `approved_at` | |
| `title_override` | null = use DB A's title |
| `summary_override` | null = use DB A's summary |
| `image_override` | null = use DB A's image |

**Feed order is approval order.** There is no `position` column to write —
position is derived by ordering on `approved_at`. Don't try to reorder by writing
a rank; the CMS deliberately doesn't model one.

Then fetch the referenced rows from **DB A**:

```sql
-- DB A, read only
select id, title, edited_title, summary, edited_summary, category, topic, section,
       source, image_url, fact_score, fact_label, fact_notes, status,
       sent_at, created_at, scraped_at
from articles
where id in (:ids)
```

### Resolution order (important)

For each selected article, the value the reader sees is:

```
title   = selection.title_override   ?? article.edited_title   ?? article.title
summary = selection.summary_override ?? article.edited_summary ?? article.summary
image   = selection.image_override   ?? article.image_url
```

The CMS override wins, then the pipeline's own edit, then the raw scrape. Getting
this order wrong means editors' corrections silently don't reach readers — it is
the single most likely integration bug.

`fact_score` (0–100) and `fact_label` come from the pipeline's fact-check and are
meant to be surfaced; `source` is the publisher name and must be credited.

---

## 6. Engagement — likes, dislikes, shares

**Status: does not exist. No table, no column, no endpoint.**

Be clear on this: the heart / bookmark / share icons visible in the CMS Pix
preview are **artwork inside the poster mockup**. They are not wired to anything.
The CMS builder source even notes the engagement bar was deliberately not ported.
There is nothing to read and nothing to write today.

You need a migration. Here is a design that fits the existing conventions.

### Proposed schema

```sql
create type reaction_kind as enum ('like', 'dislike', 'save', 'share');

-- One row per person per item per reaction. The unique constraint is what makes
-- "one like per reader" true rather than aspirational.
create table content_reactions (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null,           -- content_items.id
  article_id  text null,               -- DB A article id, for pipeline stories
  reader_id   uuid not null,           -- auth.uid()
  kind        reaction_kind not null,
  created_at  timestamptz not null default now(),
  unique (reader_id, item_id, kind),
  check ((item_id is null) <> (article_id is null))
);

-- Denormalised counts. Do not count(*) the table on every feed read.
create table content_metrics (
  item_id     uuid primary key,
  likes       int not null default 0,
  dislikes    int not null default 0,
  saves       int not null default 0,
  shares      int not null default 0,
  views       int not null default 0,
  updated_at  timestamptz not null default now()
);
```

Note the `check` constraint: a reaction targets **either** a CMS item **or** a
pipeline article, never both. The feed has two sources, so engagement must too —
this is the part most likely to be got wrong.

Keep `content_metrics` in step with a trigger on `content_reactions`, not from the
client. A client that writes its own counts is a client that can write any counts.

### RLS you must add

- **insert**: only where `reader_id = auth.uid()`
- **delete**: only own rows (un-liking)
- **select on `content_reactions`**: own rows only — one reader must not be able
  to enumerate another's reading history
- **select on `content_metrics`**: public read
- **no client write to `content_metrics` at all** — trigger only

### Shares and views

A share leaves the app, so you cannot confirm it landed. Record *share intent*,
and never present it as reach. Views need a definition before they mean anything:
pick one (e.g. card ≥50% visible for ≥2s, once per session) and write it down,
because "views" compared across two different definitions is just noise.

---

## 7. Media

**`cover_url` may be a `data:` URL.** The Pix builder commits its poster as an
inline JPEG (~300 KB) rather than uploading to storage. A `media_assets` table
exists in the schema but the CMS does not use it.

Consequences you must handle:

- An image URL may be `data:image/jpeg;base64,...` and hundreds of KB. Don't
  assume `http`. Don't pass it to a CDN image proxy.
- Feed payloads are therefore **much larger than usual**. Select only the columns
  you need for a list view; fetch `cover_url` lazily or paginate tightly, or a
  20-item feed will run to megabytes.
- This is worth fixing on the CMS side (upload to Supabase Storage, store a URL).
  Raise it — it is a known shortcut, not a design decision.

Qix video is served by the CMS at `/api/media/<filename>` with byte-range support,
which is fine for development. For production these should be on storage or a CDN;
do not depend on the Next.js route.

---

## 8. Gotchas that will cost you a day each

1. **`scheduled_at` is not enforced.** The column exists; nothing publishes on a
   schedule. A row is visible the moment `status = 'published'`. If you honour
   `scheduled_at` client-side and the CMS doesn't, the two disagree.
2. **Two ID spaces.** CMS items are uuids; pipeline articles are DB A text ids.
   A single `id` field in your feed model will collide. Carry the source with it.
3. **RLS returns empty, not an error.** A query that isn't permitted comes back
   `200` with `[]`. An empty feed is far more likely to be a policy problem than
   an empty database — check `auth.uid()` before you debug the query.
4. **`KIND_META.article.tagline` still says "60-word stories".** The real limit is
   300 characters. The tagline is stale copy; trust the constants.
5. **Language and state are per-item.** `language` ∈ en/hi/te and `state` is a
   free-text Indian state. If you build regional feeds, filter server-side —
   pulling everything and filtering on device wastes the payload budget.
6. **Demo accounts are live.** `admin@ / editor@ / writer@ / qa@dailymattr.com`
   all share password `mattr123`. They must be deleted or rotated before launch;
   they are staff accounts with write access.

---

## 9. Ranking

**Status: nothing exists. This is a proposal, not a spec.**

Today the order is editorial: `approved_at` for pipeline stories, `published_at`
for CMS items, with `is_featured` marking a hero. That is a deliberate choice —
a news desk decides what leads.

If you add algorithmic ranking, some ground rules that follow from this product:

- **Recency dominates.** This is news. A day-old story losing to a week-old one
  because it got more likes is a bug, not personalisation. Use a decay
  (e.g. score / (hours + 2)^1.5) so engagement breaks ties within a window rather
  than overriding time.
- **Never let engagement outrank the editorial hero.** `is_featured` is a human
  decision; ranking should reorder below it, not through it.
- **Dislike is a suppression signal, not a negative score.** Treat it as "show me
  less of this category/source for this reader", not as arithmetic subtracted from
  likes — otherwise brigading rewrites the newsroom's judgement.
- **Don't rank on unauthenticated counts.** See §2. If reader identity is a
  spoofable device id, engagement is untrusted input and must not move ordering.
- **Diversity cap.** Cap consecutive items from one `source` or `category_slug`,
  or the feed collapses into whichever publisher files most.

Before any of this, you need the metrics from §6 and a definition of a view. Rank
on data you actually trust.

---

## 10. Suggested order of work

1. Read-only feed from both sources with the override resolution in §5. No
   engagement, no ranking. Prove the merge and the overrides are right.
2. Reader identity (§2) — pick anonymous auth.
3. Engagement migration (§6) with RLS and the counter trigger.
4. Wire like / dislike / save / share to it. Optimistic UI, reconcile on response.
5. Only then consider ranking (§9).

Steps 1 and 2 are independent of the CMS team. Step 3 is a schema change to DB B
and should be agreed with them, since RLS there is load-bearing.

---

## Open questions for the CMS team

- Should `cover_url` move to Supabase Storage? (§7 — affects every feed payload)
- Is `scheduled_at` meant to publish, or should it be dropped? (§8.1)
- Should engagement live in DB B, or a third project the app owns? Writes from
  readers into the editorial database is the main argument against.
- Is there a canonical "view" definition already, or is the app defining it?
