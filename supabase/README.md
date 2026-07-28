# DailyMattr CMS — database

Two Supabase projects, deliberately separate.

| | Project | Role |
|---|---|---|
| **DB B** | `DailyMattr CMS` — `ijnlvyctwgdvsedpejva` (ap-south-1) | Everything the Studio authors. Read **and** write. |
| **DB A** | `Shortly-email-agent` — `ygxdrphajvrbjcaxhvcn` (ap-southeast-2) | The NewsStudio agent pipeline. **Read only** — the CMS never writes here. |

Editorial changes to a pipeline article are stored as overrides on
`article_selections` in DB B, so DB A stays untouched.

## Applied migrations

Run in this order against a fresh project (they are already applied to
`ijnlvyctwgdvsedpejva`):

| # | Migration | What it does |
|---|---|---|
| 1 | `cms_core_schema` | Enums, `cms_users`, `categories`, `media_assets`, `content_items`, `article_selections`, `audit_log`, indexes, `updated_at` trigger |
| 2 | `cms_rls_policies` | Enables RLS on every table and adds the role policies |
| 3 | `enforce_publish_permission` | Trigger gating the publish transition |
| 4 | `seed_users_and_categories` | Four demo users, eight categories |
| 5 | `seed_content_items` | Dummy Pix / Qix / Trax / article rows across every status |
| 6 | `seed_selections_and_audit` | Approved app feed + audit trail |
| 7 | `revoke_helper_function_execute` | *(superseded by 9)* |
| 8 | `seed_auth_users_for_demo` | Real `auth.users` rows for the demo logins |
| 9 | `move_helpers_to_private_schema` | Moves policy helpers into `private` so PostgREST can't expose them |

## Views

`user_performance` — one row per person for the admin's Team page: what they
created by format, where it got to (draft / awaiting QA / sent back / live),
and what they moved through as a reviewer. Aggregated in Postgres rather than
by pulling every content row into the browser, since the content table only
grows. Declared `security_invoker`, so it is read through the caller's RLS.

## Tables

`content_items` is one table for all four formats. Format-specific payload lives
in the `body` JSONB column — Pix key points as `body.points`, Qix poster config,
Trax chapters — matching how the app already stores them. `article_selections`
holds the approved app feed; **feed order is approval order**, so `position` is
derived on read from `approved_at` and never written.

## Permission model

RLS mirrors `can.*` in `portal/lib/auth.tsx`, so the rules that used to only hide
buttons are now enforced by the database:

- **Writer** — creates and edits only their own work, and only while it is
  `draft` or `rejected`
- **QA** — reads everything, approves or rejects, but **cannot publish**
- **Chief editor / super admin** — publishes, manages categories
- **Super admin** — manages users

Publishing can't be expressed as a row policy ("QA may approve yet not
publish"), so a `before update` trigger enforces that transition. Verified by
direct API calls: writer publish → 403, QA publish → 403, QA approve → OK,
chief editor publish → OK.

Policy helper functions live in the `private` schema. PostgREST only exposes
`public`, so they aren't reachable at `/rest/v1/rpc/...` while policies can
still call them.

## Demo logins

`admin@` · `editor@` · `writer@` · `qa@dailymattr.com` — password `mattr123`.

> These are seeded demo accounts with a weak shared password. Delete them or
> rotate the passwords before anyone real uses this project, and turn on leaked-
> password protection in Auth settings (Supabase currently flags it as off).
