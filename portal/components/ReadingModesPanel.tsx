"use client";

import { useState } from "react";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useToast } from "@/lib/toast";

/* The three other ways a story can be read.
 *
 * The app shows "Explain like I'm 5", a 60-second read and key numbers as
 * swipeable retellings behind the summary — but almost nothing carries them.
 * They came only from the pipeline summariser, which has reached a fraction of
 * the feed, and desk-written stories could never have them at all.
 *
 * Generate fills the fields; it does not save them. An editor reads what came
 * back and decides — which is the entire reason this lives in the Studio rather
 * than in the app. A retelling that quietly invents a figure is worse than no
 * retelling, and this panel is the thing standing between the two.
 */

export interface ReadingModes {
  eli5: string;
  tldr: string[];
  keyNumbers: string[];
}

export const EMPTY_MODES: ReadingModes = { eli5: "", tldr: [], keyNumbers: [] };

/** True when there is nothing here worth saving. */
export const modesAreEmpty = (m: ReadingModes | null | undefined) =>
  !m ||
  (!m.eli5.trim() &&
    m.tldr.every((s) => !s.trim()) &&
    m.keyNumbers.every((s) => !s.trim()));

/** Strips blanks so the app never renders an empty bullet. */
export const tidyModes = (m: ReadingModes): ReadingModes => ({
  eli5: m.eli5.trim(),
  tldr: m.tldr.map((s) => s.trim()).filter(Boolean),
  keyNumbers: m.keyNumbers.map((s) => s.trim()).filter(Boolean),
});

const ELI5_MAX = 400;
const POINT_MAX = 110;
const MAX_POINTS = 4;

function PointList({
  label,
  hint,
  points,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  points: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12px] font-bold">{label}</span>
        <span className="text-[11px] text-faint">{hint}</span>
      </div>
      <div className="space-y-2">
        {points.map((p, i) => (
          <div key={i} className="flex items-start gap-2">
            <input
              value={p}
              disabled={disabled}
              maxLength={POINT_MAX}
              onChange={(e) => {
                const next = [...points];
                next[i] = e.target.value;
                onChange(next);
              }}
              placeholder={`Point ${i + 1}`}
              className="flex-1 rounded-xl border border-line bg-transparent px-3 py-2 text-[13px] outline-none focus:border-accent disabled:opacity-50"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(points.filter((_, n) => n !== i))}
              title="Remove"
              className="btn-ghost mt-0.5 flex h-8 w-8 items-center justify-center !p-0 hover:!text-rose disabled:opacity-40"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {points.length < MAX_POINTS && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([...points, ""])}
            className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold disabled:opacity-40"
          >
            <Plus size={12} /> Add point
          </button>
        )}
      </div>
    </div>
  );
}

export function ReadingModesPanel({
  modes,
  onChange,
  story,
  disabled = false,
}: {
  modes: ReadingModes;
  onChange: (next: ReadingModes) => void;
  /** What the model is asked to retell. */
  story: { title: string; summary: string; body?: string };
  disabled?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const res = await fetch("/api/modes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(story),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't generate.");
      onChange(json.modes as ReadingModes);
      toast.success("Generated — read them before saving");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate.");
    } finally {
      setBusy(false);
    }
  };

  const eli5Over = modes.eli5.length > ELI5_MAX;

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">Reading modes</h3>
          <p className="mt-0.5 text-[11px] text-faint">
            Swipeable retellings behind the summary. Optional — a story with
            none simply shows its summary.
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={busy || disabled || (!story.title.trim() && !story.summary.trim())}
          className="btn-primary flex items-center gap-2 px-4 py-2 text-[13px] disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {busy ? "Writing…" : modesAreEmpty(modes) ? "Generate" : "Regenerate"}
        </button>
      </div>

      <div className="space-y-5">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[12px] font-bold">Explain like I&apos;m 5</span>
            <span
              className={`text-[11px] tabular-nums ${eli5Over ? "text-rose" : "text-faint"}`}
            >
              {modes.eli5.length}/{ELI5_MAX}
            </span>
          </div>
          <textarea
            value={modes.eli5}
            disabled={disabled}
            rows={4}
            onChange={(e) => onChange({ ...modes, eli5: e.target.value })}
            placeholder="What happened, and why it matters, to someone with no background in the subject."
            className={`w-full resize-y rounded-xl border bg-transparent px-3 py-2 text-[13px] leading-relaxed outline-none disabled:opacity-50 ${
              eli5Over ? "border-rose" : "border-line focus:border-accent"
            }`}
          />
        </div>

        <PointList
          label="60-second read"
          hint="complete sentences, not a teaser"
          points={modes.tldr}
          onChange={(tldr) => onChange({ ...modes, tldr })}
          disabled={disabled}
        />

        <PointList
          label="Key numbers"
          hint="only figures the story actually states"
          points={modes.keyNumbers}
          onChange={(keyNumbers) => onChange({ ...modes, keyNumbers })}
          disabled={disabled}
        />
      </div>

      <p className="mt-4 text-[11px] text-faint">
        Generated text is a draft. Check every figure against the story before
        saving — the app shows these as the story&apos;s own words.
      </p>
    </div>
  );
}
