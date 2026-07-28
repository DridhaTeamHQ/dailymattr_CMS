#!/usr/bin/env node
/**
 * One-time move of inline cover images into Supabase Storage.
 *
 * content_items.cover_url used to hold base64 data URIs — up to 1.99 MB of
 * string in a column that every library grid selects. This decodes each one,
 * uploads the bytes unchanged, and replaces the column with the object's public
 * URL.
 *
 * Nothing is re-encoded. The bytes written to Storage are the bytes that were
 * in the database, so this cannot change how any existing cover looks.
 *
 * Safe to re-run: rows that no longer hold a data URI are skipped, so an
 * interrupted run resumes where it stopped.
 *
 *   node scripts/migrate-covers-to-storage.mjs           # report only
 *   node scripts/migrate-covers-to-storage.mjs --apply   # actually migrate
 *
 * Needs a service-role key, because it writes on behalf of no particular user:
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key from Dashboard > API> \
 *   node scripts/migrate-covers-to-storage.mjs --apply
 *
 * The service-role key bypasses RLS. Keep it out of .env.local, out of git, and
 * out of anything that ships to the browser — pass it on the command line for
 * this run and forget it.
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes("--apply");
const BUCKET = "covers";

if (!url || !key) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Find both in the Supabase dashboard under Project Settings > API."
  );
  process.exit(1);
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** Splits a data URI into its mime type and raw bytes. No transcoding. */
function decodeDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1) return null;
  const header = dataUrl.slice(5, comma);
  const isBase64 = header.endsWith(";base64");
  const type = (isBase64 ? header.slice(0, -7) : header) || "image/jpeg";
  const body = dataUrl.slice(comma + 1);
  const bytes = isBase64
    ? Buffer.from(body, "base64")
    : Buffer.from(decodeURIComponent(body), "utf8");
  return { type, bytes };
}

const kb = (n) => `${Math.round(n / 1024)} KB`;

async function main() {
  const { data: rows, error } = await db
    .from("content_items")
    .select("id, title, kind, cover_url")
    .like("cover_url", "data:%");

  if (error) {
    console.error("Could not read content_items:", error.message);
    process.exit(1);
  }

  if (!rows.length) {
    console.log("Nothing to do — no cover_url holds a data URI.");
    return;
  }

  const totalBytes = rows.reduce((a, r) => a + r.cover_url.length, 0);
  console.log(
    `${rows.length} row(s) with inline covers, ${kb(totalBytes)} of column data.`
  );
  if (!APPLY) {
    for (const r of rows) {
      console.log(`  • ${r.kind} ${r.id}  ${kb(r.cover_url.length)}  ${r.title || "(untitled)"}`);
    }
    console.log("\nDry run. Re-run with --apply to migrate.");
    return;
  }

  let done = 0;
  let failed = 0;

  for (const r of rows) {
    const decoded = decodeDataUrl(r.cover_url);
    if (!decoded) {
      console.error(`  ✗ ${r.id}: cover_url is not a readable data URI`);
      failed++;
      continue;
    }

    const objectKey = `migrated/${randomUUID()}.${EXT[decoded.type] ?? "bin"}`;
    const { error: upErr } = await db.storage
      .from(BUCKET)
      .upload(objectKey, decoded.bytes, {
        contentType: decoded.type,
        cacheControl: "31536000",
        upsert: false,
      });
    if (upErr) {
      console.error(`  ✗ ${r.id}: upload failed — ${upErr.message}`);
      failed++;
      continue;
    }

    const publicUrl = db.storage.from(BUCKET).getPublicUrl(objectKey).data.publicUrl;

    // The column is only rewritten once the object is known to exist, so a
    // crash between the two leaves an orphan file rather than a broken row.
    const { error: updErr } = await db
      .from("content_items")
      .update({ cover_url: publicUrl })
      .eq("id", r.id);
    if (updErr) {
      console.error(`  ✗ ${r.id}: uploaded but row update failed — ${updErr.message}`);
      failed++;
      continue;
    }

    done++;
    console.log(
      `  ✓ ${r.kind} ${r.id}  ${kb(decoded.bytes.length)} ${decoded.type}  ${r.title || "(untitled)"}`
    );
  }

  console.log(`\nMigrated ${done}, failed ${failed}.`);

  const { count } = await db
    .from("content_items")
    .select("id", { count: "exact", head: true })
    .like("cover_url", "data:%");
  console.log(`Rows still holding a data URI: ${count ?? "unknown"}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
