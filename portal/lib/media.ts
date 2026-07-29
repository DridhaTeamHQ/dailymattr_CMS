/* What the app can actually play, decided once.
 *
 * The CMS and the reader had different opinions about this, and the gap is
 * where the broken items got through. The CMS asked "does this end in .mp4",
 * so a YouTube link rendered as "No video yet" even though the URL was right
 * there; the app asked something else again; and nothing at all asked whether
 * a Qix being published had any media on it, so five went live with
 * `media_url` null — nothing to play, in either place, by construction.
 *
 * These rules mirror `src/lib/media.ts` in the app. If the two ever disagree
 * again, the CMS is the one that must move: the app is what a reader sees.
 */

const FILE_RE = /\.(mp4|m4v|mov|webm|m3u8|mpd)(\?|#|$)/i;
const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|opus)(\?|#|$)/i;
const YOUTUBE_RE = /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;
const HTTP_RE = /^https?:\/\/\S+$/i;

/** Locally downloaded media, served by /api/media. Absolute once saved. */
const LOCAL_RE = /\/api\/media\/[^/]+$/i;

export const YOUTUBE_ID_RE = [
  /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/i,
  /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i,
  /youtube\.com\/live\/([A-Za-z0-9_-]{6,})/i,
  /youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{6,})/i,
  /youtu\.be\/([A-Za-z0-9_-]{6,})/i,
];

export function youtubeId(url: string | null | undefined): string | null {
  const s = (url ?? "").trim();
  for (const re of YOUTUBE_ID_RE) {
    const m = re.exec(s);
    if (m) return m[1];
  }
  return null;
}

/** A file a player can open directly, rather than a page about a video. */
export function isMediaFile(url: string | null | undefined): boolean {
  const s = (url ?? "").trim();
  if (!s) return false;
  if (s.startsWith("data:video") || s.startsWith("data:audio")) return true;
  if (LOCAL_RE.test(s)) return true;
  return FILE_RE.test(s) || AUDIO_RE.test(s);
}

/**
 * Whether a Qix has something the reader can watch — a file, or a YouTube
 * video the app plays through its embed.
 */
export function isPlayableVideo(url: string | null | undefined): boolean {
  const s = (url ?? "").trim();
  if (!s) return false;
  return isMediaFile(s) || !!youtubeId(s);
}

/** Trax is audio: there is no embed to fall back on, so it must be a file. */
export function isPlayableAudio(url: string | null | undefined): boolean {
  return isMediaFile((url ?? "").trim());
}

/* Hosts whose URLs are signed and expire within hours, so a saved one is dead
   by the time anyone opens the item again. Never publishable. */
const EXPIRING = [
  "googlevideo.com",
  "gtv-videos-bucket",
  "commondatastorage.googleapis.com",
];

export function isExpiringUrl(url: string | null | undefined): boolean {
  const s = (url ?? "").toLowerCase();
  return EXPIRING.some((h) => s.includes(h));
}

/* Hosts that can never resolve, reserved by RFC 2606 and RFC 6761 precisely so
   that documentation and seed data cannot be mistaken for the real thing.
   The one published Trax points at `cdn.dailymattr.example`, which looks
   entirely plausible in a text field and will 404 on every device forever. */
const UNRESOLVABLE_TLD = /\.(example|invalid|test|localdomain)(:\d+)?(\/|$)/i;
const UNRESOLVABLE_HOST = /^https?:\/\/(www\.)?example\.(com|net|org)(:\d+)?(\/|$)/i;

export function isPlaceholderUrl(url: string | null | undefined): boolean {
  const s = (url ?? "").trim();
  if (!s) return false;
  let host: string;
  try {
    host = new URL(s).host;
  } catch {
    return false;
  }
  return UNRESOLVABLE_TLD.test(host + "/") || UNRESOLVABLE_HOST.test(s);
}

/* Hosts that exist, but only on the machine that asks for them.
 *
 * `localhost` on a phone is the phone. A Qix is live right now pointing at
 * http://localhost:3000/api/media/… — a perfectly well-formed absolute URL
 * that resolves for whoever is sitting at the CMS and for nobody else. It is
 * a worse failure than a relative path, because it *looks* fixed. */
const PRIVATE_HOST =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|.*\.local)$/i;

export function isUnreachableHost(url: string | null | undefined): boolean {
  const s = (url ?? "").trim();
  if (!s) return false;
  try {
    return PRIVATE_HOST.test(new URL(s).hostname);
  } catch {
    return false;
  }
}

/* Media that exists, on the wrong machine.
 *
 * The importer stages downloads into the CMS's own `public/uploads` and, until
 * now, saved that path — so there are a dozen real clips sitting on one laptop
 * while the media bucket has never received a single object. The files are
 * fine; only their address is wrong, and the browser that shows the CMS can
 * still reach them. That makes them recoverable rather than lost, which is
 * what `rehostable` marks.
 */
const LOCAL_MEDIA_RE = /\/api\/media\/([^/?#]+)$/i;

/** The `/api/media/…` path for a clip still stored on the CMS machine. */
export function localMediaPath(url: string | null | undefined): string | null {
  const s = (url ?? "").trim();
  if (!s) return null;
  // relative (`/api/media/x.mp4`) or absolute-but-local (`http://localhost:3000/…`)
  if (!s.startsWith("/") && !isUnreachableHost(s)) return null;
  const m = LOCAL_MEDIA_RE.exec(s);
  return m ? `/api/media/${m[1]}` : null;
}

/** True when a one-click move to the bucket would fix this item. */
export const rehostable = (url: string | null | undefined) => !!localMediaPath(url);

/**
 * Why this item cannot go live, or null if it can. One sentence, addressed to
 * the editor — it is shown to them verbatim.
 */
export function mediaBlocker(
  kind: "article" | "pix" | "qix" | "trax",
  mediaUrl: string | null | undefined
): string | null {
  if (kind !== "qix" && kind !== "trax") return null;

  const s = (mediaUrl ?? "").trim();
  const noun = kind === "qix" ? "video" : "audio";

  if (!s) {
    return `This ${kind} has no ${noun} on it. Import or upload one before publishing — a reader would get a blank card.`;
  }
  if (isExpiringUrl(s)) {
    return `That ${noun} link is a temporary signed URL and will be dead within hours. Import the file instead.`;
  }
  if (isPlaceholderUrl(s)) {
    return `That host is a reserved placeholder that can never resolve, so the ${noun} would 404 on every device. Point it at the real file.`;
  }
  if (isUnreachableHost(s)) {
    return `That ${noun} is on localhost, which on a reader's phone means their phone. Set MEDIA_BASE_URL to a public address and re-import, or host the file somewhere the app can reach.`;
  }
  /* An inlined file is not a link, it *is* the file — sitting in a text column
     and travelling inside every feed response that mentions the row. Dropping
     a file uploads it to the media bucket now, so this only catches items
     created before that existed. */
  if (s.startsWith("data:")) {
    return `That ${noun} is embedded in the database rather than stored. Re-upload the file so it gets a real URL.`;
  }
  if (kind === "trax" && !isPlayableAudio(s)) {
    return HTTP_RE.test(s)
      ? "That audio link is not a file the app can play. It needs to point at an .mp3/.m4a/.aac file."
      : "The audio URL needs to be a full https:// link to an audio file.";
  }
  if (kind === "qix" && !isPlayableVideo(s)) {
    return HTTP_RE.test(s)
      ? "The app cannot play that link. Use a YouTube link, or import the file."
      : "The video URL needs to be a full https:// link, or an imported file.";
  }
  /* A relative path resolves against whatever host asks for it, which for the
     phone is not this server. The import writes absolute URLs now; anything
     still relative predates that and would 404 on a device. */
  if (s.startsWith("/")) {
    return `That ${noun} is stored as a path rather than a full URL, so the app cannot fetch it. Re-import it.`;
  }
  return null;
}
