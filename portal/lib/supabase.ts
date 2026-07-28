"use client";

import { createClient } from "@supabase/supabase-js";

/**
 * Two databases, deliberately.
 *
 * `supabase`  — DB B, the CMS. Everything the Studio authors lives here and is
 *               written through RLS policies that mirror the role rules.
 * `newsstudio` — DB A, the NewsStudio pipeline. READ ONLY. The agent pipeline
 *               owns it, so the CMS only ever selects from it; editorial
 *               changes are stored as overrides on article_selections in DB B.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const nsUrl = process.env.NEXT_PUBLIC_NEWSSTUDIO_URL;
const nsKey = process.env.NEXT_PUBLIC_NEWSSTUDIO_ANON_KEY;

if (!url || !key) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — copy .env.local from the project root."
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Read-only client for the pipeline database. Never call insert/update here. */
export const newsstudio =
  nsUrl && nsKey
    ? createClient(nsUrl, nsKey, { auth: { persistSession: false } })
    : null;

export const hasNewsStudio = () => newsstudio !== null;
