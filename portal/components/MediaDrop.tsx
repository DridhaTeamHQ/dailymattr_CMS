"use client";

import { useRef, useState } from "react";
import { UploadCloud, X } from "lucide-react";
import { MEDIA, UploadError, uploadBlob } from "@/lib/storage";

/**
 * Files went into the item as base64 data URLs, which is why they were capped
 * at 15 MB — base64 inflates by a third, so a 15 MB clip became a 20 MB string
 * in a database column. They upload to Storage now and the row keeps a URL, so
 * the ceiling is the bucket's and nothing is re-encoded on the way in.
 */
const MAX_BYTES = 200 * 1024 * 1024;

const getYoutubeId = (url: string | null) => {
  if (!url) return null;
  const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  const beMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (shortsMatch) return shortsMatch[1];
  if (watchMatch) return watchMatch[1];
  if (beMatch) return beMatch[1];
  return null;
};

export default function MediaDrop({
  value,
  onChange,
  onDurationChange,
  accept = "image/*,video/*",
  hint = "Drop MP4/WebM video file",
  aspectRatio = "standard",
}: {
  value: string | null;
  /** Receives the stored file's public URL, or null when cleared. */
  onChange: (url: string | null) => void;
  onDurationChange?: (sec: number) => void;
  accept?: string;
  hint?: string;
  aspectRatio?: "standard" | "portrait";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handle = async (file: File | undefined) => {
    setErr(null);
    if (!file || busy) return;
    if (file.size > MAX_BYTES) {
      setErr(
        `That file is ${Math.round(file.size / 1_048_576)} MB, over the ${MAX_BYTES / 1_048_576} MB limit — use a video URL instead.`
      );
      return;
    }
    setBusy(true);
    try {
      // The File is sent as-is: no data-URL round trip, no re-encode.
      onChange(await uploadBlob(MEDIA, file, "upload"));
    } catch (e) {
      setErr(
        e instanceof UploadError
          ? `Upload failed: ${e.message}`
          : "Could not upload that file."
      );
    } finally {
      setBusy(false);
    }
  };

  const ytId = getYoutubeId(value);

  const isVideo =
    value &&
    (value.startsWith("data:video") ||
      value.endsWith(".mp4") ||
      value.endsWith(".webm") ||
      value.includes("gtv-videos") ||
      value.includes("mixkit"));

  if (value) {
    return (
      <div
        className={`relative overflow-hidden rounded-2xl border border-line bg-black ${
          aspectRatio === "portrait"
            ? "mx-auto aspect-[9/16] min-h-[440px] w-full max-w-[280px]"
            : "h-44 w-full"
        }`}
      >
        {ytId ? (
          <iframe
            src={`https://www.youtube.com/embed/${ytId}?autoplay=1&mute=0&controls=1&loop=1`}
            className="h-full w-full object-cover border-0"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : isVideo ? (
          <video
            src={value}
            controls
            autoPlay
            muted
            loop
            onLoadedMetadata={(e) => {
              const dur = Math.round(e.currentTarget.duration);
              if (dur && !isNaN(dur) && isFinite(dur)) {
                onDurationChange?.(dur);
              }
            }}
            className="h-full w-full object-cover"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          // Not lazy: this is the file the user just picked, so it is the one
          // thing they are waiting to see.
          <img
            src={value}
            alt="Media preview"
            decoding="async"
            className="h-full w-full object-cover"
          />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onChange(null);
          }}
          className="absolute top-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/80 text-white shadow-lg backdrop-blur-md transition-all hover:bg-rose hover:scale-105 active:scale-95 cursor-pointer"
          title="Remove media"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handle(e.dataTransfer.files?.[0]);
        }}
        className={`flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 text-center transition-all ${
          aspectRatio === "portrait"
            ? "mx-auto aspect-[9/16] min-h-[440px] w-full max-w-[280px]"
            : "py-8"
        } ${
          drag
            ? "border-accent bg-tint"
            : "border-line bg-field hover:border-accent/50 hover:bg-tint/50"
        }`}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-accent shadow-sm">
          <UploadCloud size={22} />
        </span>
        <div className="space-y-1">
          <span className="block text-sm font-bold text-ink">
            {busy ? (
              "Uploading…"
            ) : (
              <>
                Drop a media file or <span className="text-accent">browse</span>
              </>
            )}
          </span>
          <span className="block text-xs font-medium text-faint">
            {busy ? "Sending the original file, unchanged" : hint}
          </span>
        </div>
      </button>
      {err && <p className="mt-2 text-xs font-medium text-rose">{err}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handle(e.target.files?.[0])}
      />
    </div>
  );
}
