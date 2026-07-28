"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { ContentStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/types";

const TONES: Record<string, string> = {
  // `line` rather than a literal: the neutral chip was hard-coded near-white,
  // so in dark mode it kept a pale background under text that had flipped
  // light — 2.3:1, effectively unreadable.
  muted: "bg-line text-muted",
  accent: "bg-tint text-accent",
  mint: "bg-mint-tint text-mint",
  amber: "bg-amber-tint text-amber",
  rose: "bg-rose-tint text-rose",
  violet: "bg-violet-tint text-violet",
};

export function Pill({
  tone = "muted",
  children,
}: {
  tone?: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return <span className={`pill ${TONES[tone]}`}>{children}</span>;
}

export function StatusPill({ status }: { status: ContentStatus }) {
  const m = STATUS_META[status];
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

export function Avatar({
  name,
  hue,
  size = 36,
}: {
  name: string;
  hue: number;
  size?: number;
}) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${hue} 80% 58%), hsl(${hue + 40} 80% 48%))`,
      }}
    >
      {initials}
    </div>
  );
}

export function SectionHeader({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "sm",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** sm — a single column of fields. md — two columns. lg — the reader. */
  size?: "sm" | "md" | "lg";
}) {
  const width = { sm: "max-w-lg", md: "max-w-2xl", lg: "max-w-3xl" }[size];
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-shell/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            className={`card relative z-10 max-h-[88vh] w-full overflow-y-auto p-7 shadow-(--shadow-pop) ${width}`}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold">{title}</h2>
              <button
                onClick={onClose}
                className="btn-ghost flex h-9 w-9 items-center justify-center !p-0"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function EmptyState({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-8 py-16 text-center">
      <div className="text-4xl">✦</div>
      <div className="text-lg font-bold">{title}</div>
      <p className="max-w-sm text-sm text-muted">{sub}</p>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function FactBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const tone = score >= 93 ? "mint" : score >= 85 ? "amber" : "rose";
  return <Pill tone={tone}>FACT {score}</Pill>;
}
