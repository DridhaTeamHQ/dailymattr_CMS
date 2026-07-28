import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { acquireSlot, clientIp, rateLimit, releaseSlot } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Downloading and remuxing a Reel takes real time; a stuck job must not hang a worker. */
const JOB_TIMEOUT_MS = 180_000;
const MAX_URL_CHARS = 512;

/** Video downloads are far heavier than a text scrape, so the quotas are tighter. */
const RULES = (ip: string) => [
  { key: `scrape-video:ip:${ip}:min`, limit: 3, windowMs: 60_000 },
  { key: `scrape-video:ip:${ip}:hr`, limit: 20, windowMs: 3_600_000 },
  { key: "scrape-video:global:hr", limit: 60, windowMs: 3_600_000 },
];

const HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "instagram.com",
  "www.instagram.com",
];

/**
 * Only well-formed links to the two supported sites get near the downloader.
 * The URL is passed to yt-dlp as an argv entry (never a shell string), so this
 * is defence in depth rather than the only thing standing between us and a
 * crafted argument.
 */
function validateUrl(raw: string): { url: string } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "Paste a YouTube or Instagram link first." };
  if (trimmed.length > MAX_URL_CHARS) return { error: "That URL is too long." };
  if (trimmed.startsWith("-")) return { error: "That doesn't look like a link." };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "Only http and https links can be imported." };
  }
  if (!HOSTS.includes(url.hostname.toLowerCase())) {
    return { error: "Only YouTube and Instagram links can be imported." };
  }
  return { url: url.toString() };
}

interface WorkerResult {
  success: boolean;
  error?: string;
  code?: string;
  title?: string;
  filename?: string;
  sizeBytes?: number;
  coverUrl?: string;
  durationSec?: number | null;
  uploader?: string;
  width?: number;
  height?: number;
  isVertical?: boolean;
}

/** Runs the yt-dlp worker, killing it if it outlives the timeout. */
function runWorker(url: string, outDir: string): Promise<WorkerResult> {
  const script = path.join(process.cwd(), "scripts", "scrape_video.py");
  const python = process.env.PYTHON_BIN ?? "python";

  return new Promise((resolve) => {
    const child = spawn(python, [script, url, outDir], {
      windowsHide: true,
      // No shell: argv is passed through untouched, so the URL cannot be
      // interpreted as a command.
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: WorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        success: false,
        error: "The download took too long and was stopped.",
        code: "timeout",
      });
    }, JOB_TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
      console.error("[scrape-video] spawn failed:", err.message);
      finish({
        success: false,
        error: missing
          ? "Python isn't available on the server. Install Python and yt-dlp, or set PYTHON_BIN."
          : "Could not start the video downloader.",
        code: "spawn_failed",
      });
    });

    child.on("close", () => {
      if (stderr.trim()) console.warn("[scrape-video] worker stderr:", stderr.slice(0, 800));
      try {
        finish(JSON.parse(stdout.trim()) as WorkerResult);
      } catch {
        console.error("[scrape-video] unparseable worker output:", stdout.slice(0, 500));
        finish({
          success: false,
          error: "The video downloader returned an unreadable response.",
          code: "bad_output",
        });
      }
    });
  });
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const slotKey = `scrape-video:${ip}`;

  const limited = rateLimit(RULES(ip));
  if (!limited.ok) {
    return NextResponse.json(
      { success: false, error: `Too many downloads. Try again in ${limited.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  // Downloads are expensive; one at a time per caller.
  if (!acquireSlot(slotKey)) {
    return NextResponse.json(
      { success: false, error: "A download is already running. Wait for it to finish." },
      { status: 429 }
    );
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const raw = (body as { url?: unknown })?.url;
    if (typeof raw !== "string") {
      return NextResponse.json(
        { success: false, error: "A video URL is required." },
        { status: 400 }
      );
    }

    const checked = validateUrl(raw);
    if ("error" in checked) {
      return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
    }

    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    const result = await runWorker(checked.url, uploadsDir);

    if (!result.success || !result.filename) {
      const status =
        result.code === "missing_dependency" || result.code === "spawn_failed"
          ? 503
          : result.code === "timeout"
            ? 504
            : result.code === "needs_cookies" || result.code === "private"
              ? 403
              : 422;
      return NextResponse.json(
        { success: false, error: result.error ?? "Could not import that video." },
        { status }
      );
    }

    // Guard against a worker returning a path outside the uploads directory.
    const safeName = path.basename(result.filename);
    if (!fs.existsSync(path.join(uploadsDir, safeName))) {
      return NextResponse.json(
        { success: false, error: "The downloaded file is missing." },
        { status: 500 }
      );
    }

    console.info(
      `[scrape-video] ${safeName} · ${Math.round((result.sizeBytes ?? 0) / 1024)}KB · ${result.durationSec ?? "?"}s`
    );

    /* Absolute, because this URL is going into a database the phone reads.
     *
     * It used to be saved as `/api/media/<file>`, which resolves against
     * whoever asks for it — fine in a browser pointed at this server, and
     * meaningless on a device, where it is not a URL at all. A Qix imported
     * that way went live with media the reader could never fetch.
     *
     * MEDIA_BASE_URL is for when the CMS runs behind a domain or proxy that
     * the request origin does not reveal; otherwise the origin is right. */
    const base = (process.env.MEDIA_BASE_URL ?? new URL(req.url).origin).replace(/\/+$/, "");

    return NextResponse.json({
      success: true,
      // The editor gates its success line on this; the import either produces
      // a file or returns an error, so it is always true when we get here.
      isDownloaded: true,
      url: checked.url,
      title: result.title || null,
      videoUrl: `${base}/api/media/${encodeURIComponent(safeName)}`,
      coverUrl: result.coverUrl || null,
      durationSec: result.durationSec ?? null,
      uploader: result.uploader || null,
      width: result.width ?? null,
      height: result.height ?? null,
      isVertical: result.isVertical ?? null,
      sizeBytes: result.sizeBytes ?? null,
    });
  } catch (err) {
    console.error("[scrape-video] unexpected", err);
    return NextResponse.json(
      { success: false, error: "Something went wrong while importing that video." },
      { status: 500 }
    );
  } finally {
    releaseSlot(slotKey);
  }
}
