"use client";

import Link from "next/link";
import { useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { PixBezel } from "@/components/PixPoster";
import { Modal, Pill, StatusPill } from "@/components/ui";
import {
  PIX_CHARS_PER_LINE,
  PIX_GEOMETRY,
  PIX_LINES,
  filledPixPoints,
  pixLines,
  type PixPlacement,
} from "@/lib/pix";
import type { ContentItem } from "@/lib/types";

/**
 * The list-card placement, in a light bezel so it reads as a phone preview
 * rather than a CMS card. Shared by the Pix grid and the QA review queue.
 */
export function PixFrame({
  item,
  onClick,
  placement = "list",
}: {
  item: ContentItem;
  onClick?: () => void;
  placement?: PixPlacement;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={onClick ? `Preview ${item.title}` : undefined}
      className={`rounded-[26px] shadow-(--shadow-soft) ${
        onClick
          ? "cursor-pointer transition-transform duration-200 hover:-translate-y-1 hover:shadow-(--shadow-lift)"
          : ""
      }`}
    >
      <PixBezel item={item} placement={placement} size="sm" />
    </div>
  );
}

/**
 * Pix tile for the grid — the poster as it lands in the app feed, with the
 * writer's Edit / View / Delete row. Pass `actions` to swap in role-specific
 * controls (e.g. QA approve / decline).
 */
export function PixCard({
  item,
  author,
  onView,
  actions,
}: {
  item: ContentItem;
  author?: string;
  onView: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[210px] flex-col gap-2">
      <PixFrame item={item} onClick={onView} />

      <div className="flex flex-wrap items-center gap-1.5">
        {actions ?? (
          <>
            <Link
              href={`/content/pix/editor?id=${item.id}`}
              className="btn-primary flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-[11px]"
            >
              <Pencil size={11} /> Edit
            </Link>
            <button
              type="button"
              onClick={onView}
              className="btn-ghost flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-[11px]"
            >
              <Eye size={11} /> View
            </button>
          </>
        )}
      </div>

      {/* Status lives out here — the poster itself stays true to the app. */}
      <div className="flex items-center justify-center gap-1.5">
        <StatusPill status={item.status} />
      </div>
      <p className="truncate text-center text-[10px] text-faint">
        {author ?? "—"}
        {item.state ? ` · ${item.state}` : ""}
      </p>
    </div>
  );
}

/** Per-placement fit report — flags copy the app would clip. */
function FitReport({ item }: { item: ContentItem }) {
  const points = filledPixPoints(item);
  const rows: [string, number, number, number][] = [
    [
      "Headline · list",
      pixLines(item.title, PIX_CHARS_PER_LINE.headlineList),
      PIX_LINES.headline,
      PIX_CHARS_PER_LINE.headlineList,
    ],
    [
      "Headline · page",
      pixLines(item.title, PIX_CHARS_PER_LINE.headlinePage),
      PIX_LINES.headline,
      PIX_CHARS_PER_LINE.headlinePage,
    ],
    ...points.map(
      (p, i) =>
        [
          `Point ${i + 1}`,
          pixLines(p, PIX_CHARS_PER_LINE.point),
          PIX_LINES.point,
          PIX_CHARS_PER_LINE.point,
        ] as [string, number, number, number]
    ),
  ];

  return (
    <div className="rounded-2xl bg-canvas p-3">
      <p className="label mb-2">Fit</p>
      <div className="space-y-1">
        {rows.map(([label, lines, max]) => (
          <div
            key={label}
            className="flex items-center justify-between text-[11px]"
          >
            <span className="text-muted">{label}</span>
            <span
              className={`font-bold tabular-nums ${
                lines > max ? "text-rose" : "text-mint"
              }`}
            >
              {lines} / {max} lines{lines > max ? " · clipped" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Full Pix preview. Shows the two placements the spec defines — the 327 × 480
 * list card and the full-bleed 375 × 812 page card. `actions` fills the footer
 * so each role brings its own controls.
 */
export function PixPreviewModal({
  item,
  onClose,
  actions,
}: {
  item: ContentItem | null;
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <Modal open={!!item} onClose={onClose} title="Pix preview">
      {/* Keyed on the id so each Pix opens fresh on the feed placement. */}
      {item && (
        <PreviewBody
          key={item.id}
          item={item}
          onClose={onClose}
          actions={actions}
        />
      )}
    </Modal>
  );
}

function PreviewBody({
  item,
  onClose,
  actions,
}: {
  item: ContentItem;
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  const [placement, setPlacement] = useState<PixPlacement>("list");
  const g = PIX_GEOMETRY[placement];

  return (
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="mx-auto w-full max-w-[260px] shrink-0">
            <div className="mb-3 flex items-center gap-1 rounded-full bg-canvas p-1">
              {(
                [
                  ["list", "Feed card"],
                  ["page", "Reader page"],
                ] as [PixPlacement, string][]
              ).map(([p, label]) => (
                <button
                  key={p}
                  onClick={() => setPlacement(p)}
                  className={`flex-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${
                    placement === p
                      ? "bg-ink text-white"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="shadow-(--shadow-lift)">
              <PixBezel item={item} placement={placement} size="lg" />
            </div>

            <p className="mt-2 text-center text-[10px] text-faint tabular-nums">
              {g.w} × {g.h} · photo {Math.round(g.photo * 100)}%
            </p>
          </div>

          <div className="min-w-0 flex-1">
            <p className="mb-3 text-[15px] leading-snug font-bold">
              {item.title}
            </p>
            <ul className="space-y-2">
              {filledPixPoints(item).map((p, i) => (
                <li key={i} className="flex gap-2 text-sm leading-snug">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {item.tags.map((t) => (
                <Pill key={t} tone="muted">
                  #{t}
                </Pill>
              ))}
              <Pill tone="accent">{item.language.toUpperCase()}</Pill>
              {item.state && <Pill tone="muted">{item.state}</Pill>}
            </div>

            <div className="mt-4">
              <FitReport item={item} />
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {actions}
              <button onClick={onClose} className="btn-ghost px-5 py-2.5 text-sm">
                Close
              </button>
            </div>
          </div>
        </div>
  );
}
