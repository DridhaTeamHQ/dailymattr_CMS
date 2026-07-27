"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles, Star } from "lucide-react";
import { FactBadge, Pill, SectionHeader, StatusPill } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import {
  contentByKind,
  getNewsStudio,
  getSelections,
  logAudit,
  saveSelections,
  timeAgo,
} from "@/lib/store";
import { useStore } from "@/lib/useStore";

type Tab = "newsstudio" | "cms";

export default function ArticlesPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("newsstudio");
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);

  const data = useStore(
    () => ({
      newsstudio: getNewsStudio(),
      selections: getSelections(),
      written: contentByKind("article"),
    }),
    [tick]
  );

  if (!user || !data) return null;
  const curator = can.curate(user.role);

  const toggle = (articleId: string, feature = false) => {
    if (!curator) return;
    const sel = getSelections();
    const existing = sel.find((s) => s.articleId === articleId);
    const art = data.newsstudio.find((n) => n.id === articleId);
    let next;
    if (existing && feature) {
      existing.isFeatured = !existing.isFeatured;
      next = [...sel];
    } else if (existing) {
      next = sel.filter((s) => s.articleId !== articleId);
    } else {
      next = [
        ...sel,
        {
          articleId,
          position: sel.length + 1,
          isFeatured: feature,
          selectedBy: user.id,
          selectedAt: new Date().toISOString(),
        },
      ];
    }
    saveSelections(next);
    if (art)
      logAudit(
        user,
        existing && !feature ? "removed from feed" : feature ? "featured" : "added to feed",
        "newsstudio article",
        art.title
      );
    setTick((t) => t + 1);
  };

  const filtered = data.newsstudio.filter(
    (n) =>
      n.title.toLowerCase().includes(query.toLowerCase()) ||
      n.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div>
      <SectionHeader
        title="Articles"
        sub="NewsStudio pipeline (read-only) + articles written in the Studio."
      >
        <Link
          href="/content/articles/editor"
          className="btn-primary px-5 py-2.5 text-sm"
        >
          + Write article
        </Link>
      </SectionHeader>

      {/* tabs */}
      <div className="mb-5 flex w-fit items-center gap-1 rounded-full bg-white p-1 shadow-(--shadow-soft)">
        {(
          [
            ["newsstudio", `NewsStudio · ${data.newsstudio.length}`],
            ["cms", `Written in Studio · ${data.written.length}`],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative rounded-full px-4 py-2 text-[13px] font-bold transition-colors ${
              tab === t ? "text-white" : "text-muted hover:text-ink"
            }`}
          >
            {tab === t && (
              <motion.span
                layoutId="tab-active"
                className="absolute inset-0 rounded-full bg-ink"
                transition={{ type: "spring", stiffness: 400, damping: 34 }}
              />
            )}
            <span className="relative z-10">{label}</span>
          </button>
        ))}
      </div>

      {tab === "newsstudio" ? (
        <>
          <input
            className="field mb-5 max-w-sm !rounded-full !bg-white shadow-(--shadow-soft)"
            placeholder="Filter by title or category…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((n, i) => {
              const sel = data.selections.find((s) => s.articleId === n.id);
              return (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.4 }}
                  className="card card-hover overflow-hidden"
                >
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={n.imageUrl}
                      alt=""
                      className="h-36 w-full object-cover"
                    />
                    <div className="absolute top-3 left-3 flex gap-1.5">
                      <Pill tone="accent">{n.category}</Pill>
                      {sel?.isFeatured && <Pill tone="violet">Featured</Pill>}
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="line-clamp-2 text-[14px] leading-snug font-bold">
                      {n.title}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">
                      {n.summary}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <FactBadge score={n.factScore} />
                        <span className="text-[11px] text-faint">
                          {n.sourceCount} SRC · {n.source}
                        </span>
                      </div>
                      <span className="text-[11px] text-faint">
                        {timeAgo(n.publishedAt)}
                      </span>
                    </div>
                    {curator && (
                      <div className="mt-3 flex gap-2 border-t border-line pt-3">
                        <button
                          onClick={() => toggle(n.id)}
                          className={`flex-1 py-2 text-xs ${
                            sel ? "btn-primary" : "btn-ghost"
                          }`}
                        >
                          {sel ? "In app feed ✓" : "Add to app feed"}
                        </button>
                        <button
                          onClick={() => toggle(n.id, true)}
                          title="Feature"
                          className={`btn-ghost flex h-9 w-9 items-center justify-center !p-0 ${
                            sel?.isFeatured ? "!border-violet !text-violet" : ""
                          }`}
                        >
                          {sel?.isFeatured ? (
                            <Sparkles size={14} />
                          ) : (
                            <Star size={14} />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {data.written.length === 0 && (
            <div className="card p-10 text-center text-sm text-muted">
              Nothing written yet — click{" "}
              <span className="font-bold text-ink">Write article</span> to start.
            </div>
          )}
          {data.written.map((c) => (
            <Link
              key={c.id}
              href={`/content/articles/editor?id=${c.id}`}
              className="card card-hover flex items-center gap-4 p-4"
            >
              {c.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.coverUrl}
                  alt=""
                  className="h-16 w-24 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <div className="h-16 w-24 shrink-0 rounded-xl bg-canvas" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold">{c.title}</p>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                  {c.summary}
                </p>
                <p className="mt-1 text-[11px] text-faint">
                  Updated {timeAgo(c.updatedAt)}
                </p>
              </div>
              <StatusPill status={c.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
