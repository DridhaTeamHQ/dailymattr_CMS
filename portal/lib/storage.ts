"use client";

import { supabase } from "./supabase";

/**
 * File storage for cover art and media.
 *
 * Covers used to be base64 data URIs held in content_items.cover_url — up to
 * 1.99 MB of string travelling in every row a library grid loaded. That is why
 * the composer downgraded posters to 1x JPEG before saving them. Files live in
 * Storage now, so a row carries a short URL and the poster can be kept at the
 * resolution it was composed at.
 *
 * Both buckets are public-read: the DailyMattr app renders these to readers who
 * were never signed into the CMS. Writes are gated by RLS on storage.objects.
 */

export const COVERS = "covers";
export const MEDIA = "media";

export class UploadError extends Error {}

/** Extension per mime type, so objects are recognisable in the dashboard. */
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
};

/**
 * A collision-free object key.
 *
 * crypto.randomUUID rather than a title slug or a timestamp: titles get edited
 * and renamed, and two people committing in the same second would otherwise
 * overwrite each other's poster.
 */
function objectKey(prefix: string, type: string) {
  const ext = EXT[type] ?? "bin";
  return `${prefix}/${crypto.randomUUID()}.${ext}`;
}

/** Decodes a data: URI without a network round trip through fetch(). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1)
    throw new UploadError("Not a data URL.");
  const header = dataUrl.slice(5, comma);
  const isBase64 = header.endsWith(";base64");
  const type = (isBase64 ? header.slice(0, -7) : header) || "application/octet-stream";
  const body = dataUrl.slice(comma + 1);

  if (!isBase64) return new Blob([decodeURIComponent(body)], { type });

  const binary = atob(body);
  // Copy through a typed array; a string of 2 MB of binary handed straight to
  // Blob would be re-encoded as UTF-8 and corrupt the file.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Uploads a blob and returns its public URL.
 *
 * `upsert: false` — keys are UUIDs, so a collision means something is wrong and
 * should surface rather than silently replace someone's file.
 */
export async function uploadBlob(
  bucket: string,
  blob: Blob,
  prefix: string
): Promise<string> {
  const key = objectKey(prefix, blob.type);
  const { error } = await supabase.storage.from(bucket).upload(key, blob, {
    contentType: blob.type,
    cacheControl: "31536000", // immutable: the key changes when the file does
    upsert: false,
  });
  if (error) throw new UploadError(error.message);

  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  if (!data?.publicUrl) throw new UploadError("Upload succeeded but no public URL came back.");
  return data.publicUrl;
}

/** Convenience for the common case: a canvas or scrape result as a data URL. */
export async function uploadDataUrl(
  bucket: string,
  dataUrl: string,
  prefix: string
): Promise<string> {
  return uploadBlob(bucket, dataUrlToBlob(dataUrl), prefix);
}

/** True for values that are already stored files rather than inline blobs. */
export const isStoredUrl = (v: string | null | undefined) =>
  !!v && /^https?:\/\//.test(v);
