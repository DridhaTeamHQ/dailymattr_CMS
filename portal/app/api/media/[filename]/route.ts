import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Serves a file from public/uploads.
 *
 * Streams rather than buffering, and honours Range requests — without them the
 * browser cannot seek within a video, and a scrubbed timeline silently snaps
 * back to the start.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  if (!filename) return new NextResponse("Filename is required", { status: 400 });

  // basename strips any ../ traversal before the path is joined.
  const safeName = path.basename(decodeURIComponent(filename));
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  const filePath = path.join(uploadsDir, safeName);

  if (path.dirname(filePath) !== uploadsDir) {
    return new NextResponse("Not found", { status: 404 });
  }

  let size: number;
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return new NextResponse("Not found", { status: 404 });
    size = stat.size;
  } catch {
    return new NextResponse("Media file not found", { status: 404 });
  }

  const contentType = MIME[path.extname(safeName).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (!match[1] && !match[2])) {
      return new NextResponse("Malformed range", {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }

    // A suffix range ("bytes=-500") asks for the final N bytes.
    let start: number;
    let end: number;
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
    } else {
      start = size - Number(match[2]);
      end = size - 1;
    }
    end = Math.min(end, size - 1);

    if (!Number.isFinite(start) || start < 0 || start > end) {
      return new NextResponse("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }

    const stream = Readable.toWeb(
      createReadStream(filePath, { start, end })
    ) as ReadableStream;

    return new NextResponse(stream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
