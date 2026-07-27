"use client";

import { useRef, useState } from "react";
import { UploadCloud, X } from "lucide-react";

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
  onChange: (dataUrl: string | null) => void;
  onDurationChange?: (sec: number) => void;
  accept?: string;
  hint?: string;
  aspectRatio?: "standard" | "portrait";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handle = (file: File | undefined) => {
    setErr(null);
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setErr("File is larger than 15 MB limit — use a video URL instead.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
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
          <img src={value} alt="Media preview" className="h-full w-full object-cover" />
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
            : "border-line bg-[#fafafc] hover:border-accent/50 hover:bg-tint/50"
        }`}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-accent shadow-sm">
          <UploadCloud size={22} />
        </span>
        <div className="space-y-1">
          <span className="block text-sm font-bold text-ink">
            Drop a media file or <span className="text-accent">browse</span>
          </span>
          <span className="block text-xs font-medium text-faint">{hint}</span>
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
