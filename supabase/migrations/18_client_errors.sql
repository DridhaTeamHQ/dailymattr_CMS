-- Somewhere for a failure to land.
--
-- Every error in the Studio ended at console.error in a browser nobody is
-- watching. If a writer's save failed at four in the afternoon, the first
-- anyone heard of it was when they said so — and what they say is "it didn't
-- work", not the message that would identify it.
--
-- This is not a replacement for a real error service: no grouping, no
-- alerting, no release tracking. It is the smallest thing that turns "someone
-- said it broke" into a row with a message, a stack, a page and a person.
--
-- Written by portal/lib/report.ts. Read in the Supabase table editor.

create table if not exists client_errors (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  -- Null for a failure before or during sign-in, which is exactly when the
  -- account is most worth knowing and least available.
  actor_id     uuid references cms_users(id) on delete set null,
  actor_email  text,
  -- "error" for a thrown exception, "rejection" for an unhandled promise,
  -- "boundary" for a React error boundary catching a render.
  kind         text not null check (kind in ('error', 'rejection', 'boundary')),
  message      text not null,
  stack        text,
  -- Where it happened and what was being used, so a report can be reproduced
  -- rather than guessed at.
  path         text,
  user_agent   text,
  -- React's own grouping id when a boundary provides one.
  digest       text
);

-- The two questions anyone asks: what broke recently, and is this one thing
-- happening over and over.
create index if not exists client_errors_recent_idx
  on client_errors (created_at desc);
create index if not exists client_errors_message_idx
  on client_errors (message, created_at desc);

alter table client_errors enable row level security;

-- Anyone signed in may report. The alternative is losing the reports that
-- matter most: a page too broken to establish who the user is.
drop policy if exists "signed-in users can report an error" on client_errors;
create policy "signed-in users can report an error"
  on client_errors for insert
  to authenticated
  with check (true);

-- Reading is an administrator's. A stack trace is a description of how the
-- software is put together, and there is no reason for a writer to have it.
drop policy if exists "admins read the error log" on client_errors;
create policy "admins read the error log"
  on client_errors for select
  to authenticated
  using (private.is_admin());

-- Nobody edits an error report; a wrong one is deleted, not corrected. There
-- is deliberately no update policy at all.
drop policy if exists "admins clear the error log" on client_errors;
create policy "admins clear the error log"
  on client_errors for delete
  to authenticated
  using (private.is_admin());

comment on table client_errors is
  'Failures reported by the Studio in the browser. Insert-only for users, readable by admins. Prune periodically — nothing here is worth keeping for long.';
