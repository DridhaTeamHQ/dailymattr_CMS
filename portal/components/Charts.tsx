"use client";

import { useState, type ReactNode } from "react";
import { fmt } from "@/components/StatsStrip";

/* Chart parts, drawn by hand.
 *
 * The Studio carries no charting library and does not need one: every shape on
 * the analytics screens is a bar, a line or a grid, and a dependency that ships
 * its own renderer and theme would cost more than it saves. These are divs and
 * inline SVG on the app's own tokens, so they follow the theme without being
 * told about it.
 *
 * Everything here takes numbers already computed. None of it fetches, and none
 * of it decides what a figure means.
 */

/* ────────────────────────────── chrome ────────────────────────────── */

/** A small rounded label, for filters and context ("Timezone: Asia/Calcutta"). */
export function Chip({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "amber" | "mint";
}) {
  const cls = {
    muted: "border-line text-muted",
    accent: "border-accent/30 bg-tint text-accent",
    amber: "border-amber/30 bg-amber-tint text-amber",
    mint: "border-mint/30 bg-mint-tint text-mint",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

/** A solid coloured disc with an icon in it — the reference's KPI marker. */
export function IconBadge({
  icon: Icon,
  tone,
  size = 44,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: "accent" | "violet" | "amber" | "mint" | "rose";
  size?: number;
}) {
  const bg = {
    accent: "bg-accent",
    violet: "bg-violet",
    amber: "bg-amber",
    mint: "bg-mint",
    rose: "bg-rose",
  }[tone];
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full text-white ${bg}`}
      style={{ width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.45)} />
    </span>
  );
}

/**
 * A headline figure with the marker on the right, as the reference lays it
 * out. `hint` carries the caveat; `extra` is for the small chips under it.
 */
export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone,
  change,
  extra,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: "accent" | "violet" | "amber" | "mint" | "rose";
  change?: number;
  extra?: ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-[0.12em] text-faint uppercase">
            {label}
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[30px] leading-none font-extrabold tabular-nums">
              {typeof value === "number" ? fmt(value) : value}
            </span>
            {change !== undefined && (
              <span
                className={`text-[11px] font-bold tabular-nums ${
                  change >= 0 ? "text-mint" : "text-rose"
                }`}
              >
                {change >= 0 ? "+" : ""}
                {change}%
              </span>
            )}
          </div>
        </div>
        <IconBadge icon={icon} tone={tone} />
      </div>
      {hint && <p className="mt-3 text-[12px] leading-snug text-muted">{hint}</p>}
      {extra && <div className="mt-3 flex flex-wrap gap-1.5">{extra}</div>}
    </div>
  );
}

/** A plainer stat, for the secondary strips. */
export function Stat({
  label,
  value,
  hint,
  tone = "accent",
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "accent" | "violet" | "amber" | "mint" | "rose";
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="card flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-faint">{label}</div>
        <div className="mt-1.5 text-2xl leading-none font-extrabold tabular-nums">
          {typeof value === "number" ? fmt(value) : value}
        </div>
        {hint && <div className="mt-2 text-[11px] text-faint">{hint}</div>}
      </div>
      {icon && <IconBadge icon={icon} tone={tone} size={28} />}
    </div>
  );
}

/** Card wrapper so every panel gets the same title, note and spacing. */
export function Panel({
  title,
  note,
  right,
  children,
}: {
  title: string;
  note?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-bold">{title}</h2>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {note && <p className="mb-4 text-[11px] leading-snug text-faint">{note}</p>}
      {children}
    </div>
  );
}

/* ────────────────────────────── charts ────────────────────────────── */

/** Round the axis top up to something a person would draw: 0, 9, 18, 27. */
function niceMax(max: number, steps = 4): number {
  if (max <= 0) return steps;
  const rough = max / steps;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return step * steps;
}

/**
 * Bars on a real axis: gridlines, tick labels, a hover tooltip.
 *
 * Unlike the ranking bars, these are read against an axis — the question is
 * "how many", not "which is longest" — so the scale starts at zero and the top
 * is a round number rather than the largest bar.
 */
export function AxisBarChart({
  labels,
  values,
  tone = "fill-accent",
  height = 220,
  format = (n: number) => fmt(n),
  name,
  onSelect,
}: {
  labels: readonly string[];
  values: number[];
  tone?: string;
  height?: number;
  format?: (n: number) => string;
  /** Series name in the tooltip: "Open rate (%): 12.7". */
  name?: string;
  /** When given, bars become clickable and drill one level down. */
  onSelect?: (index: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const STEPS = 4;
  const top = niceMax(Math.max(...values, 0), STEPS);
  const W = 1000;
  const H = height;
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = Math.max(values.length, 1);
  const slot = plotW / n;
  // Bars fill most of their slot but leave a gutter, and never get so wide on a
  // three-bar chart that they read as blocks.
  const barW = Math.min(slot * 0.72, 90);

  /* Dense x axes thin their labels rather than overlapping them. Eight is
     what fits across 1000 units once a label reads "08-26 6am-9am"; twelve
     collided into an unreadable smear. */
  const every = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height }}
        role="img"
        aria-label={name ?? "bar chart"}
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: STEPS + 1 }, (_, i) => {
          const y = padT + plotH - (plotH * i) / STEPS;
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y}
                y2={y}
                className="stroke-line"
                strokeDasharray="4 4"
              />
              <text
                x={padL - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-faint"
                fontSize={12}
              >
                {format((top * i) / STEPS)}
              </text>
            </g>
          );
        })}

        {values.map((v, i) => {
          const h = top ? (v / top) * plotH : 0;
          const x = padL + slot * i + (slot - barW) / 2;
          const y = padT + plotH - h;
          const active = hover === i;
          return (
            <g key={i}>
              {/* A wide invisible hit area so hovering the gap still targets a
                  bar — and, where the chart drills down, so does clicking it. */}
              <rect
                x={padL + slot * i}
                y={padT}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={onSelect ? () => onSelect(i) : undefined}
                style={onSelect ? { cursor: "pointer" } : undefined}
              />
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, v > 0 ? 2 : 0)}
                rx={3}
                className={tone}
                opacity={hover === null || active ? 1 : 0.55}
              />
              {i % every === 0 && (
                <text
                  x={padL + slot * i + slot / 2}
                  y={H - 12}
                  textAnchor="middle"
                  className="fill-faint"
                  fontSize={11}
                >
                  {labels[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-line bg-card px-3 py-2 text-[11px] shadow-(--shadow-pop)"
          style={{
            left: `${((padL + slot * hover + slot / 2) / W) * 100}%`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="font-bold">{labels[hover]}</div>
          <div className="text-accent">
            {name ? `${name}: ` : ""}
            {format(values[hover])}
          </div>
        </div>
      )}
    </div>
  );
}

/** Several series on one axis, grouped per label. */
export function GroupedAxisChart({
  labels,
  series,
  height = 220,
  onSelect,
}: {
  labels: readonly string[];
  series: { name: string; tone: string; values: number[] }[];
  height?: number;
  /** When given, a group becomes clickable and drills one level down. */
  onSelect?: (index: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const STEPS = 4;
  const top = niceMax(Math.max(...series.flatMap((s) => s.values), 0), STEPS);
  const W = 1000;
  const H = height;
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const slot = plotW / Math.max(labels.length, 1);
  const inner = slot * 0.74;
  const barW = inner / series.length;
  const every = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap gap-4">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-[11px] font-bold">
            <span className={`h-2.5 w-2.5 rounded-sm ${s.tone.replace("fill-", "bg-")}`} />
            {s.name}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height }}
        role="img"
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: STEPS + 1 }, (_, i) => {
          const y = padT + plotH - (plotH * i) / STEPS;
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} className="stroke-line" strokeDasharray="4 4" />
              <text x={padL - 10} y={y + 4} textAnchor="end" className="fill-faint" fontSize={12}>
                {fmt((top * i) / STEPS)}
              </text>
            </g>
          );
        })}
        {labels.map((label, i) => (
          <g key={label + i}>
            <rect
              x={padL + slot * i}
              y={padT}
              width={slot}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onClick={onSelect ? () => onSelect(i) : undefined}
              style={onSelect ? { cursor: "pointer" } : undefined}
            />
            {series.map((s, j) => {
              const h = top ? (s.values[i] / top) * plotH : 0;
              const x = padL + slot * i + (slot - inner) / 2 + barW * j;
              return (
                <rect
                  key={s.name}
                  x={x + 1}
                  y={padT + plotH - h}
                  width={Math.max(barW - 2, 1)}
                  height={Math.max(h, s.values[i] > 0 ? 2 : 0)}
                  rx={2}
                  className={s.tone}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              );
            })}
            {i % every === 0 && (
              <text
                x={padL + slot * i + slot / 2}
                y={H - 12}
                textAnchor="middle"
                className="fill-faint"
                fontSize={11}
              >
                {label}
              </text>
            )}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-10 rounded-lg border border-line bg-card px-3 py-2 text-[11px] shadow-(--shadow-pop)"
          style={{
            left: `${((padL + slot * hover + slot / 2) / W) * 100}%`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="font-bold">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex justify-between gap-4 tabular-nums">
              <span className="text-muted">{s.name}</span>
              <span className="font-bold">{fmt(s.values[hover])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Horizontal bars with a label and a value, scaled to the largest row. These
 * are read as a ranking — which is longest — not against an axis.
 *
 * The value rides at the tip of its own bar rather than in a column at the far
 * right. Down that column the number and the bar it belongs to could be a
 * hundred points of empty track apart, so reading "how long" and "how many"
 * together meant crossing the row twice.
 *
 * That is what `FILL` is for: bars are scaled into the leftmost 82% so the
 * longest one still has somewhere to put its number. Nothing is lost by it —
 * these have no axis to be measured against, only each other, and every bar is
 * shortened by the same factor.
 */
const FILL = 78;

export function BarList({
  rows,
  tone = "bg-accent",
  format = (n: number) => fmt(n),
  onSelect,
  selected,
}: {
  rows: { name: string; value: number; key?: string }[];
  tone?: string;
  format?: (n: number) => string;
  /** Makes the rows clickable. Receives `key` when a row carries one. */
  onSelect?: (key: string) => void;
  /** The picked row's key, drawn as held down. */
  selected?: string | null;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => {
        const id = r.key ?? r.name;
        const pct = Math.max(1.5, (r.value / max) * FILL);
        const isOn = selected != null && selected === id;
        const body = (
          <>
            <span
              className={`w-28 shrink-0 truncate text-[12px] font-bold ${
                selected != null && !isOn ? "text-muted" : ""
              }`}
            >
              {r.name}
            </span>
            {/* Not overflow-hidden: the value sits inside this box, past the
                end of the fill, and clipping is exactly what it must not do. */}
            <div className="relative h-2 flex-1 rounded-full bg-canvas">
              <div
                className={`h-full rounded-full ${tone} ${
                  selected != null && !isOn ? "opacity-40" : ""
                }`}
                style={{ width: `${pct}%` }}
              />
              <span
                className="absolute top-1/2 ml-2 -translate-y-1/2 text-[12px] font-bold whitespace-nowrap tabular-nums"
                style={{ left: `${pct}%` }}
              >
                {format(r.value)}
              </span>
            </div>
          </>
        );

        return onSelect ? (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={isOn}
            /* Not hover:bg-canvas, which is the track's own colour — the row
               would light up by making its bar's track disappear. */
            className="flex w-full cursor-pointer items-center gap-3 rounded-lg py-0.5 text-left transition-colors hover:bg-tint"
          >
            {body}
          </button>
        ) : (
          <div key={id} className="flex items-center gap-3" data-row={i}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Day by window grid. Opacity carries the value rather than hue: one colour at
 * varying strength stays readable for anyone who cannot separate red from
 * green, and keeps the grid in the palette.
 */
export function Heatmap({
  rows,
  rowLabels,
  colLabels,
}: {
  rows: number[][];
  rowLabels: string[];
  colLabels: readonly string[];
}) {
  const max = Math.max(1, ...rows.flat());
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[440px]">
        <div className="mb-1 flex gap-1 pl-9">
          {colLabels.map((c) => (
            <div key={c} className="flex-1 text-center text-[9px] leading-tight text-faint">
              {c}
            </div>
          ))}
        </div>
        {rows.map((row, i) => (
          <div key={rowLabels[i]} className="mb-1 flex items-center gap-1">
            <div className="w-8 shrink-0 text-[10px] font-bold text-muted">{rowLabels[i]}</div>
            {row.map((v, j) => (
              <div
                key={colLabels[j]}
                className="h-7 flex-1 rounded bg-accent"
                style={{ opacity: 0.06 + (v / max) * 0.94 }}
                title={`${rowLabels[i]} ${colLabels[j]}: ${fmt(v)}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A single proportion as one bar. Used where a pie would be two slices. */
export function SplitBar({ parts }: { parts: { name: string; value: number; tone: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <>
      <div className="flex h-3 overflow-hidden rounded-full bg-canvas">
        {parts.map((p) => (
          <div key={p.name} className={p.tone} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {parts.map((p) => (
          <span key={p.name} className="flex items-center gap-1.5 text-[11px]">
            <span className={`h-2.5 w-2.5 rounded-sm ${p.tone}`} />
            <span className="font-bold">{p.name}</span>
            <span className="tabular-nums text-faint">{p.value}%</span>
          </span>
        ))}
      </div>
    </>
  );
}

/* ────────────────────────────── table ─────────────────────────────── */

export interface Column<T> {
  key: string;
  label: string;
  /** Right-align numbers so the digits line up. */
  numeric?: boolean;
  render: (row: T) => ReactNode;
}

/**
 * The data table under every chart. Scrolls inside a fixed height so a
 * fourteen-day-by-seven-window table does not push the next section off the
 * screen, and the header stays put while it does.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  maxHeight = 380,
  empty = "Nothing in this range.",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  maxHeight?: number;
  empty?: string;
}) {
  return (
    <div className="overflow-auto rounded-xl border border-line" style={{ maxHeight }}>
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2.5 text-[12px] font-semibold text-faint ${
                  c.numeric ? "text-right" : "text-left"
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={rowKey(r, i)} className="border-b border-line last:border-0 hover:bg-canvas">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5 align-top ${
                      c.numeric ? "text-right tabular-nums" : "text-left"
                    }`}
                  >
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────── controls ─────────────────────────────── */

/** The purple pill tabs the reference uses for its section switcher. */
export function PillTabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`rounded-xl px-4 py-2 text-[13px] font-bold transition-colors ${
            value === t.key
              ? "bg-violet text-white"
              : "border border-line bg-card text-ink hover:bg-canvas"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A three-way switch rendered as one joined control.
 *
 * Separate from PillTabs because it means something different: those are
 * sections of the page, this is the same data at a different resolution. One
 * joined control reads as "pick a zoom level"; three loose buttons read as
 * three unrelated actions.
 */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="text-[12px] font-semibold text-muted">{label}</span>
      )}
      <div className="inline-flex rounded-xl border border-line p-0.5">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`rounded-[10px] px-3 py-1.5 text-[12px] font-bold transition-colors ${
              value === o.key
                ? "bg-violet text-white"
                : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A labelled select in the control row. */
export function Select<K extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: K;
  options: { key: K; label: string }[];
  onChange: (k: K) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[12px] font-semibold text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as K)}
        className="rounded-xl border border-line bg-card px-3 py-2 text-[13px] font-semibold text-ink outline-none focus:border-accent"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The bordered secondary button in the control rows. */
export function GhostButton({
  children,
  onClick,
  active,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-bold transition-colors ${
        active ? "border-violet bg-violet-tint text-violet" : "border-line bg-card text-ink hover:bg-canvas"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * A multi-select built from toggles, which is also the comparison control.
 *
 * One selection filters, two or more compare — there is no separate "compare"
 * mode to turn on, because the moment a second region is chosen the only
 * sensible reading of the request is "against the first". Nothing selected
 * means everywhere, so the way back to the whole picture is to clear it rather
 * than to find an "All" entry hiding among thirty place names.
 *
 * Colours come from the caller, so the swatch here is the same colour as that
 * series in the chart below. A legend that has to be matched up by reading is
 * not a legend.
 */
export function TogglePills<K extends string>({
  options,
  selected,
  onToggle,
  onClear,
  emptyLabel,
  toneOf,
  max,
}: {
  options: { key: K; label: string; hint?: string }[];
  selected: K[];
  onToggle: (k: K) => void;
  onClear: () => void;
  /** Shown as the first pill, selected when nothing else is. */
  emptyLabel: string;
  /** Series colour for a selected key, so pill and chart agree. */
  toneOf?: (k: K) => string;
  /** Beyond this, further options are disabled rather than hidden. */
  max?: number;
}) {
  const atLimit = max !== undefined && selected.length >= max;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onClear}
        aria-pressed={selected.length === 0}
        className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
          selected.length === 0
            ? "border-violet bg-violet text-white"
            : "border-line text-muted hover:text-ink"
        }`}
      >
        {emptyLabel}
      </button>

      {options.map((o) => {
        const on = selected.includes(o.key);
        // Disabled only when it would add to a full set — never when it is
        // already chosen, or the last one in could not be taken out again.
        const blocked = atLimit && !on;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onToggle(o.key)}
            disabled={blocked}
            aria-pressed={on}
            title={
              blocked
                ? `Comparing ${max} at once is the limit — remove one first`
                : o.hint
            }
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
              on
                ? "border-transparent bg-canvas text-ink"
                : "border-line text-muted hover:text-ink"
            } ${blocked ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {on && toneOf && (
              <span
                className={`h-2 w-2 rounded-sm ${toneOf(o.key).replace("fill-", "bg-")}`}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
