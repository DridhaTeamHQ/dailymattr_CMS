#!/usr/bin/env node
/**
 * Delete uploaded files that nothing points at any more.
 *
 * Every upload here is a fresh object with a UUID name, and nothing ever
 * removes the one it replaced. Swap a Pix photograph three times and two files
 * are stranded; re-import a video and the first download is stranded; delete a
 * Qix and its clip stays in the bucket for good. On the day this was written the
 * media bucket held twenty objects, three of which were referenced — 23 MB of
 * the 44 MB was already unreachable, and it is billed like any other storage.
 *
 *   node scripts/sweep-orphan-media.mjs                 # report only
 *   node scripts/sweep-orphan-media.mjs --apply         # delete them
 *   node scripts/sweep-orphan-media.mjs --apply --hours 72
 *
 * Two safeguards, because deleting the wrong file breaks live content and
 * there is no undo:
 *
 *   - Only objects older than a grace period, 24 hours by default. A file
 *     uploaded a minute ago is very likely sitting in an editor that has not
 *     been saved yet, and its URL is nowhere in the database.
 *   - Every column that can hold one of these URLs is collected first, and a
 *     file is kept if it appears in any of them.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
 *   node scripts/sweep-orphan-media.mjs
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes("--apply");
const hoursArg = process.argv.indexOf("--hours");
const GRACE_HOURS = hoursArg > -1 ? Number(process.argv[hoursArg + 1]) : 24;
const BUCKETS = ["covers", "media"];

if (!url || !key) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Both are in the Supabase dashboard under Project Settings > API."
  );
  process.exit(1);
}
if (!Number.isFinite(GRACE_HOURS) || GRACE_HOURS < 0) {
  console.error("--hours needs a non-negative number.");
  process.exit(1);
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const mb = (n) => `${(n / 1_048_576).toFixed(1)} MB`;

/** Every object name any row still points at, across both buckets. */
async function referencedNames() {
  const names = new Set();
  const add = (value) => {
    if (typeof value !== "string") return;
    // Public URLs look like .../object/public/<bucket>/<key>. Anything else —
    // a remote news image, an empty column — is not ours to reason about.
    const m = value.match(/\/object\/public\/([^/]+)\/(.+)$/);
    if (m) names.add(`${m[1]}/${decodeURIComponent(m[2])}`);
  };

  const { data: content, error: cErr } = await db
    .from("content_items")
    .select("cover_url, cover_master_url, media_url");
  if (cErr) throw new Error(`reading content_items: ${cErr.message}`);
  for (const r of content) {
    add(r.cover_url);
    add(r.cover_master_url);
    add(r.media_url);
  }

  // Editorial overrides on pipeline articles can carry an uploaded photograph.
  const { data: sels, error: sErr } = await db
    .from("article_selections")
    .select("image_override");
  if (sErr) throw new Error(`reading article_selections: ${sErr.message}`);
  for (const r of sels) add(r.image_override);

  return names;
}

/** Storage lists a page at a time, and folders are entries with no id. */
async function listAll(bucket, prefix = "") {
  const out = [];
  const PAGE = 100;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`listing ${bucket}/${prefix}: ${error.message}`);
    if (!data.length) break;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) out.push(...(await listAll(bucket, path)));
      else out.push({ path, ...entry });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function main() {
  const referenced = await referencedNames();
  console.log(
    `${referenced.size} file(s) referenced by content.\n` +
      `Grace period: ${GRACE_HOURS}h — newer files are left alone.\n`
  );

  const cutoff = Date.now() - GRACE_HOURS * 3_600_000;
  let totalOrphans = 0;
  let totalBytes = 0;
  let deleted = 0;

  for (const bucket of BUCKETS) {
    const objects = await listAll(bucket);
    const orphans = objects.filter((o) => {
      if (referenced.has(`${bucket}/${o.path}`)) return false;
      const age = new Date(o.created_at ?? o.updated_at ?? 0).getTime();
      return age && age < cutoff;
    });
    const tooNew = objects.filter(
      (o) =>
        !referenced.has(`${bucket}/${o.path}`) &&
        !orphans.includes(o)
    ).length;

    const bytes = orphans.reduce(
      (a, o) => a + Number(o.metadata?.size ?? 0),
      0
    );
    totalOrphans += orphans.length;
    totalBytes += bytes;

    console.log(
      `${bucket}: ${objects.length} object(s), ${orphans.length} orphaned (${mb(bytes)})` +
        (tooNew ? `, ${tooNew} unreferenced but within the grace period` : "")
    );
    for (const o of orphans)
      console.log(`   • ${o.path}  ${mb(Number(o.metadata?.size ?? 0))}`);

    if (APPLY && orphans.length) {
      // Removed in batches; the API takes a list and reports per-path errors.
      for (let i = 0; i < orphans.length; i += 50) {
        const batch = orphans.slice(i, i + 50).map((o) => o.path);
        const { error } = await db.storage.from(bucket).remove(batch);
        if (error) console.error(`   ✗ ${bucket}: ${error.message}`);
        else deleted += batch.length;
      }
    }
  }

  console.log(
    `\n${totalOrphans} orphaned file(s), ${mb(totalBytes)}.` +
      (APPLY ? ` Deleted ${deleted}.` : " Dry run — re-run with --apply to delete.")
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
