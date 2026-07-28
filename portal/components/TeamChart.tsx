"use client";

import { useMemo, useState } from "react";
import { KIND_COLOR, STAGE_COLOR } from "@/lib/palette";
import { Avatar } from "@/components/ui";
import type { UserPerformance } from "@/lib/types";

/**
 * The team, side by side.
 *
 * The cards below say what each person did; they cannot say who did more,
 * because comparing five separate cards means holding five numbers in your
 * head. One shared axis answers that at a glance.
 *
 * Horizontal bars: with names on the left and five or six rows, labels read
 * beside the bar instead of rotated under it.
 *
 * Hover is not the only way in — clicking pins a row, so the breakdown is
 * reachable on a touchscreen and stays put while you read it.
 */

type Row = { p: UserPerformance; values: Record<string, number> };
type Series = { key: string; label: string; color: string };

const METRICS: { id: string; label: string; hint: string; series: Series[] }[] =
  [
    {
      id: "format",
      label: "Output",
      hint: "what each person made, by format",
      series: [
        { key: "article", label: "Articles", color: KIND_COLOR.article },
        { key: "pix", label: "Pix", color: KIND_COLOR.pix },
        { key: "qix", label: "Qix", color: KIND_COLOR.qix },
        { key: "trax", label: "Trax", color: KIND_COLOR.trax },
      ],
    },
    {
      id: "pipeline",
      label: "Pipeline",
      hint: "how far their work got",
      series: [
        { key: "live", label: "Live", color: STAGE_COLOR.live },
        { key: "cleared", label: "Cleared", color: STAGE_COLOR.cleared },
        { key: "inQa", label: "In QA", color: STAGE_COLOR.inQa },
        { key: "sentBack", label: "Sent back", color: STAGE_COLOR.sentBack },
        { key: "draft", label: "Draft", color: STAGE_COLOR.draft },
      ],
    },
    {
      id: "review",
      label: "Review",
      hint: "work of other people's they moved along",
      series: [
        { key: "reviewed", label: "Reviewed", color: KIND_COLOR.article },
        { key: "published", label: "Published", color: KIND_COLOR.trax },
        { key: "toFeed", label: "To feed", color: KIND_COLOR.pix },
      ],
    },
  ];

const valuesFor = (p: UserPerformance, metric: string): Record<string, number> =>
  metric === "format"
    ? {
        article: p.createdArticles,
        pix: p.createdPix,
        qix: p.createdQix,
        trax: p.createdTrax,
      }
    : metric === "pipeline"
      ? {
          live: p.live,
          // clearedReview counts everything that got past QA, live included —
          // subtracting keeps the stack a true part-to-whole.
          cleared: Math.max(0, p.clearedReview - p.live),
          inQa: p.awaitingReview,
          sentBack: p.sentBack,
          draft: p.inDraft,
        }
      : {
          reviewed: p.reviewed,
          published: p.publishedByThem,
          toFeed: p.articlesApproved,
        };

export default function TeamChart({
  performance,
}: {
  performance: UserPerformance[];
}) {
  const [metricId, setMetricId] = useState("format");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  const metric = METRICS.find((m) => m.id === metricId)!;
  const visible = metric.series.filter((s) => !hidden.has(s.key));

  const rows = useMemo(() => {
    const list: Row[] = performance.map((p) => ({
      p,
      values: valuesFor(p, metricId),
    }));
    const total = (r: Row) =>
      visible.reduce((a, s) => a + (r.values[s.key] ?? 0), 0);
    // Ranked, because the question this chart answers is "who did more".
    return list.sort((a, b) => total(b) - total(a) || a.p.fullName.localeCompare(b.p.fullName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performance, metricId, hidden]);

  const totalOf = (r: Row) =>
    visible.reduce((a, s) => a + (r.values[s.key] ?? 0), 0);
  const max = Math.max(1, ...rows.map(totalOf));
  const teamTotal = rows.reduce((a, r) => a + totalOf(r), 0);

  const activeId = pinned ?? hover;
  const active = rows.find((r) => r.p.id === activeId) ?? null;

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      // Never let the last series go — an empty chart reads as broken.
      if (next.has(key)) next.delete(key);
      else if (next.size < metric.series.length - 1) next.add(key);
      return next;
    });

  const switchMetric = (id: string) => {
    setMetricId(id);
    setHidden(new Set()); // series keys differ per metric
    setPinned(null);
  };

  // The panel always says something: one person when a row is active, the
  // whole newsroom otherwise. Fixed content either way, so nothing shifts.
  const panelSeries = visible.map((s) => ({
    ...s,
    n: active
      ? (active.values[s.key] ?? 0)
      : rows.reduce((a, r) => a + (r.values[s.key] ?? 0), 0),
  }));
  const panelTotal = active ? totalOf(active) : teamTotal;

  return (
    <div className="card mb-5 p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">Team comparison</h3>
          <p className="text-xs text-muted">{metric.hint}</p>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-canvas p-1">
          {METRICS.map((m) => (
            <button
              key={m.id}
              onClick={() => switchMetric(m.id)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold transition-colors ${
                m.id === metricId
                  ? "bg-shell text-white"
                  : "text-muted hover:text-ink"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend doubles as a filter — hide a format to see who leads on the
          rest. Rows re-rank as you do, which is the point. */}
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {metric.series.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              title={off ? "Show" : "Hide"}
              className={`flex items-center gap-1.5 text-[11px] font-semibold transition-opacity ${
                off ? "opacity-40" : ""
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ background: off ? "var(--color-line)" : s.color }}
              />
              <span className={off ? "text-muted line-through" : "text-ink"}>
                {s.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_190px]">
        {/* ── ranked rows ─────────────────────────────────── */}
        <div className="space-y-1" onMouseLeave={() => setHover(null)}>
          {rows.map((r) => {
            const total = totalOf(r);
            const isActive = activeId === r.p.id;
            const dim = activeId !== null && !isActive;
            return (
              <button
                key={r.p.id}
                onMouseEnter={() => setHover(r.p.id)}
                onFocus={() => setHover(r.p.id)}
                onBlur={() => setHover(null)}
                onClick={() =>
                  setPinned((prev) => (prev === r.p.id ? null : r.p.id))
                }
                aria-pressed={pinned === r.p.id}
                aria-label={`${r.p.fullName}: ${total}`}
                className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none transition-colors ${
                  isActive ? "bg-canvas" : ""
                } ${r.p.isActive ? "" : "opacity-55"}`}
              >
                <Avatar name={r.p.fullName} hue={r.p.avatarHue} size={26} />
                <span className="w-28 shrink-0 truncate text-[12px] font-semibold">
                  {r.p.fullName}
                </span>
                <span
                  className="flex h-4 flex-1 gap-[2px] overflow-hidden rounded-full transition-opacity"
                  style={{ opacity: dim ? 0.4 : 1 }}
                >
                  {total > 0 ? (
                    visible.map((s) => {
                      const n = r.values[s.key] ?? 0;
                      if (!n) return null;
                      return (
                        <span
                          key={s.key}
                          className="transition-[width] duration-500"
                          style={{
                            background: s.color,
                            width: `${(n / max) * 100}%`,
                          }}
                        />
                      );
                    })
                  ) : (
                    // A visible empty track, so zero reads as "none" rather
                    // than as a row that failed to render.
                    <span className="w-full bg-line" />
                  )}
                </span>
                <span
                  className={`w-6 shrink-0 text-right text-[12px] font-extrabold tabular-nums ${
                    total ? "text-ink" : "text-faint"
                  }`}
                >
                  {total || "—"}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── readout ─────────────────────────────────────── */}
        <div className="rounded-2xl border border-line p-4">
          <div className="mb-3 flex items-center gap-2">
            {active ? (
              <>
                <Avatar
                  name={active.p.fullName}
                  hue={active.p.avatarHue}
                  size={24}
                />
                <span className="min-w-0 truncate text-[12px] font-bold">
                  {active.p.fullName}
                </span>
              </>
            ) : (
              <span className="text-[12px] font-bold">Whole newsroom</span>
            )}
          </div>
          <div className="text-3xl leading-none font-extrabold tabular-nums">
            {panelTotal}
          </div>
          <div className="mt-1 text-[10px] font-bold tracking-wider text-faint uppercase">
            {metric.label}
          </div>
          <div className="mt-3 space-y-1.5 border-t border-line pt-3">
            {panelSeries.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-[3px]"
                  style={{ background: s.color }}
                />
                <span className="truncate text-[11px] text-muted">
                  {s.label}
                </span>
                <span className="ml-auto text-[11px] font-bold tabular-nums">
                  {s.n}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-faint">
            {pinned
              ? "Pinned — click the row again to release."
              : "Hover a row, or click to pin it."}
          </p>
        </div>
      </div>
    </div>
  );
}
