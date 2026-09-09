"use client";

import { useEffect, useState } from "react";
import { BellRing, Users } from "lucide-react";
import { Modal } from "@/components/ui";
import { fmt } from "@/components/StatsStrip";
import { listCategories, pushAudiencePreview } from "@/lib/db";
import type { PushAudiencePreview, StatsSource } from "@/lib/types";

/* The push composer.
 *
 * The bell used to be a confirm() with a number in it — "Notify 412 readers?"
 * — and the number was everyone. That is still one of the two choices. The
 * other is the story's own topic: readers whose feed leans toward it, plus
 * readers the app has not learned about yet, minus anyone who leans away or
 * turned alerts off. The counts come from the same affinity the app ranks its
 * feed with, so what the desk targets on is what the reader actually sees.
 *
 * What it does not do: let the editor pick some other topic. A Politics push
 * sent to the Sports audience is not targeting, it is a mistake with extra
 * steps, so the only rule on offer is the story's own category.
 */

export type NotifyRule = "all" | "topic";

export interface NotifyTarget {
  source: StatsSource;
  contentId: string;
  title: string;
  /**
   * How the story is categorised. A CMS slug ("politics") or a pipeline topic
   * ("Tech & AI"); resolved to the app's category name below. Null offers
   * only "everyone".
   */
  category: string | null;
}

/* The pipeline's thirteen folded into the desk's eight — the same table the
   app applies when it maps a wire story, kept in step by hand because the
   app's copy ships in the bundle. */
const PIPELINE_TOPIC_TO_CATEGORY: Record<string, string> = {
  "Tech & AI": "Technology",
  Technology: "Technology",
  Automobile: "Business",
  "Real Estate": "Business",
  "Markets & Startups": "Business",
  "Corporate Case": "Business",
  "Health & Wellness": "Science",
};

export default function NotifyDialog({
  target,
  reachable,
  onClose,
  onSend,
}: {
  target: NotifyTarget | null;
  /** Everyone with alerts on, from pushAudienceSize(). */
  reachable: number;
  onClose: () => void;
  onSend: (rule: NotifyRule, topic: string | null) => Promise<void>;
}) {
  return (
    <Modal open={!!target} onClose={onClose} title="Notify readers">
      {/* Keyed on the story so a new target starts from a clean choice
          rather than inheriting the last one's rule and counts. */}
      {target && (
        <Composer
          key={`${target.source}:${target.contentId}`}
          target={target}
          reachable={reachable}
          onClose={onClose}
          onSend={onSend}
        />
      )}
    </Modal>
  );
}

type Audience =
  | { state: "none" } // no category the app knows
  | { state: "loading" }
  | { state: "unavailable"; topic: string } // migration not applied / not allowed
  | { state: "ready"; topic: string; preview: PushAudiencePreview };

function Composer({
  target,
  reachable,
  onClose,
  onSend,
}: {
  target: NotifyTarget;
  reachable: number;
  onClose: () => void;
  onSend: (rule: NotifyRule, topic: string | null) => Promise<void>;
}) {
  const [rule, setRule] = useState<NotifyRule>("all");
  const [sending, setSending] = useState(false);
  const [audience, setAudience] = useState<Audience>(() =>
    target.category?.trim() ? { state: "loading" } : { state: "none" }
  );

  /* Resolve the story's category to the name the app carries on Article.topic
     — that is the key reader_taste is written under. A slug is looked up in
     categories; a pipeline topic goes through the fold table; anything
     unknown means no topic audience can exist for it. */
  useEffect(() => {
    const cat = target.category?.trim();
    if (!cat) return;
    let alive = true;

    (async () => {
      let name: string | null = PIPELINE_TOPIC_TO_CATEGORY[cat] ?? null;
      if (!name) {
        const cats = await listCategories().catch(() => []);
        const hit =
          cats.find((c) => c.slug === cat.toLowerCase()) ??
          cats.find((c) => c.name.toLowerCase() === cat.toLowerCase());
        name = hit?.name ?? null;
      }
      if (!alive) return;
      if (!name) {
        setAudience({ state: "none" });
        return;
      }
      const preview = await pushAudiencePreview(name);
      if (!alive) return;
      setAudience(
        preview ? { state: "ready", topic: name, preview } : { state: "unavailable", topic: name }
      );
    })();

    return () => {
      alive = false;
    };
  }, [target.category]);

  const topicName = audience.state === "ready" || audience.state === "unavailable" ? audience.topic : null;
  const topicCount =
    audience.state === "ready" ? audience.preview.positive + audience.preview.unknown : null;
  const canTopic = topicCount !== null && topicCount > 0;
  const willSend = rule === "topic" ? (topicCount ?? 0) : reachable;

  const note = (() => {
    switch (audience.state) {
      case "none":
        return "This story has no category the app knows, so it can only go to everyone.";
      case "loading":
        return "Counting…";
      case "unavailable":
        return "Targeting needs the taste migration applied in the CMS database.";
      case "ready": {
        const p = audience.preview;
        return `${fmt(p.positive)} lean toward it · ${fmt(p.unknown)} new readers included · ${fmt(p.excluded)} lean away, left alone`;
      }
    }
  })();

  const send = async () => {
    if (willSend === 0 || sending) return;
    setSending(true);
    try {
      await onSend(rule, rule === "topic" ? topicName : null);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-[13px] leading-snug">
        <span className="text-faint">About </span>
        <span className="font-bold">{target.title}</span>
      </p>

      <div className="space-y-2">
        <Choice
          on={rule === "all"}
          onPick={() => setRule("all")}
          title="Everyone"
          count={reachable}
          note="Every phone with alerts on."
        />
        <Choice
          on={rule === "topic"}
          onPick={() => canTopic && setRule("topic")}
          disabled={!canTopic}
          title={
            topicName
              ? `Readers who lean toward ${topicName}`
              : "Readers who lean toward this topic"
          }
          count={topicCount}
          loading={audience.state === "loading"}
          note={note}
        />
      </div>

      <p className="text-[11px] leading-snug text-faint">
        Counts are phones, not people, and come from what each app reports about
        its own reader. A push cannot be recalled, and a story can only be sent
        once.
      </p>

      <div className="flex items-center justify-end gap-2">
        <button onClick={onClose} disabled={sending} className="btn-ghost px-4 py-2 text-xs">
          Cancel
        </button>
        <button
          onClick={send}
          disabled={sending || willSend === 0}
          className="btn-primary flex items-center gap-1.5 px-4 py-2 text-xs disabled:opacity-40"
        >
          <BellRing size={14} />
          {sending
            ? "Sending…"
            : `Send to ${fmt(willSend)} ${willSend === 1 ? "reader" : "readers"}`}
        </button>
      </div>
    </div>
  );
}

function Choice({
  on,
  onPick,
  disabled,
  title,
  count,
  loading,
  note,
}: {
  on: boolean;
  onPick: () => void;
  disabled?: boolean;
  title: string;
  count: number | null;
  loading?: boolean;
  note: string;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={on}
      className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
        on ? "border-accent bg-tint" : "border-line hover:border-ink/30"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          on ? "border-accent" : "border-line"
        }`}
      >
        {on && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-bold">{title}</span>
          <span className="ml-auto flex items-center gap-1 text-[12px] font-bold text-muted tabular-nums">
            <Users size={12} />
            {loading ? "…" : count === null ? "—" : fmt(count)}
          </span>
        </span>
        <span className="mt-1 block text-[11px] leading-snug text-faint">{note}</span>
      </span>
    </button>
  );
}
