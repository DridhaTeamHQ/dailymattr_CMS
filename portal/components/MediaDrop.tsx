"use client";

import { useRef, useState } from "react";
import { UploadCloud, X } from "lucide-react";

export default function MediaDrop({
  value,
  onChange,
  accept = "image/*",
  hint = "PNG, JPG up to ~1.5 MB (demo)",
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  accept?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handle = (file: File | undefined) => {
    setErr(null);
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      setErr("File is larger than the 1.5 MB demo limit — link a URL instead.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  };

  if (value && value.startsWith("data:image")) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value} alt="cover" className="h-40 w-full object-cover" />
        <button
          type="button"
          onClick={() => onChange(null)}
          className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-ink/70 text-white backdrop-blur hover:bg-rose"
        >
          <X size={14} />
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
        className={`flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-all ${
          drag
            ? "border-accent bg-tint"
            : "border-line bg-[#fafafc] hover:border-accent/50 hover:bg-tint/50"
        }`}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-tint text-accent">
          <UploadCloud size={18} />
        </span>
        <span className="text-sm font-semibold">
          Drop a file or <span className="text-accent">browse</span>
        </span>
        <span className="text-xs text-faint">{hint}</span>
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
