"use client";

import { Compass } from "lucide-react";
import { fmt } from "@/components/StatsStrip";
import { useQuery } from "@/lib/useQuery";
import { listTasteSummary } from "@/lib/db";
import { timeAgo } from "@/lib/store";

/* How the audience leans, by topic.
 *
 * Not what was clicked — that is the table above it. This is what each phone
 * says about its own reader: the per-topic affinity the app ranks its feed
 * with, reported to the desk so a push can be aimed. A topic with many
 * readers and a negative lean is one people are shown often and skim, which
 * is a headline problem rather than an interest problem, and the two look
 * identical in a view count.
 */
export function AudienceTaste() {
  const { data, error } = useQuery(() => listTasteSummary());

  if (error) return null;
  if (!data) return <div className="card mt-6 h-40 animate-pulse" />;

  const max = Math.max(1, ...data.map((r) => r.devices));
  const last = data.reduce<string | null>(
    (acc, r) => (r.lastAt && (!acc || r.lastAt > acc) ? r.lastAt : acc),
    null
  );

  return (
    <div className="card mt-6 p-5">
      <div className="mb-1 flex items-center gap-2">
        <Compass size={14} className="text-faint" />
        <h2 className="text-sm font-bold">Audience taste</h2>
        {last && (
          <span className="ml-auto text-[11px] text-faint">
            reported {timeAgo(last)}
          </span>
        )}
      </div>
      <p className="mb-4 text-[11px] leading-snug text-faint">
        What each app reports about its own reader — the same lean that orders
        their feed. Bar length is how many phones have an opinion; the tint is
        which way it goes. This is the audience a targeted push draws from.
      </p>

      {data.length === 0 ? (
        <p className="text-[13px] text-muted">
          No reader has reported a lean yet. The app sends one after a few
          sessions of reading.
        </p>
      ) : (
        <div className="space-y-2.5">
          {data.map((r) => {
            const lean = Math.max(-1, Math.min(1, r.meanAffinity));
            const tone =
              lean >= 0.15 ? "bg-mint" : lean <= -0.05 ? "bg-rose" : "bg-faint";
            return (
              <div key={r.topic} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-[12px] font-bold">
                  {r.topic}
                </span>
                <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-canvas">
                  <div
                    className={`h-full rounded-full ${tone} opacity-80`}
                    style={{ width: `${Math.max(3, (r.devices / max) * 100)}%` }}
                  />
                </div>
                <span
                  className={`w-12 shrink-0 text-right text-[12px] font-bold tabular-nums ${
                    lean >= 0.15 ? "text-mint" : lean <= -0.05 ? "text-rose" : "text-muted"
                  }`}
                  title="Mean affinity, −1 to +1"
                >
                  {lean > 0 ? "+" : ""}
                  {lean.toFixed(2)}
                </span>
                <span
                  className="w-32 shrink-0 text-right text-[11px] text-faint tabular-nums"
                  title="phones with an opinion · leaning toward · leaning away"
                >
                  {fmt(r.devices)} · <span className="text-mint">{fmt(r.positive)}</span>
                  {" · "}
                  <span className="text-rose">{fmt(r.negative)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
