-- Let the desk take a comment down.
--
-- Comments arrive from readers, are shown to the desk on the analytics page,
-- and could not be removed by anyone. content_comments carries no write policy
-- at all — every reader write goes through a security-definer function, which
-- is the right shape — but none of those functions deletes, so abuse, libel and
-- spam were permanent once posted. For a news publisher that is not a missing
-- nicety; it is the absence of a takedown.
--
-- Reviewers and above, matching who already decides what reaches readers: QA,
-- chief editors and super admins. A writer moderating the replies to their own
-- story is a different question and a worse default.
--
-- This adds no way to post or to edit. Only to remove.
drop policy if exists content_comments_moderate on public.content_comments;
create policy content_comments_moderate on public.content_comments
  for delete to authenticated
  using (private.can_review());

-- Replies and likes go with it: both already cascade from
-- content_comments(id), so taking down the root of a thread takes the thread.

comment on policy content_comments_moderate on public.content_comments is
  'Takedown for reviewers and above. Reader writes still go only through the app_* functions; this adds no way to post or edit, only to remove.';

-- Note for whoever wires the same thing for pipeline articles: their threads
-- live in DB A (`app_comments`), which this project reads and never writes, so
-- a comment there cannot be removed from the Studio. lib/db.ts says so rather
-- than offering a button that quietly fails.
