"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { AudioLines, Clapperboard, Clock3, Image as ImageIcon } from "lucide-react";
import { Pill, SectionHeader, StatusPill } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { contentByKind, getUsers, timeAgo } from "@/lib/store";
import { useStore } from "@/lib/useStore";
import { KIND_META, type ContentKind } from "@/lib/types";

const VALID: ContentKind[] = ["pix", "qix", "trax"];

const ICONS = { pix: ImageIcon, qix: Clapperboard, trax: AudioLines } as const;

const fmtDur = (s: number | null) => {
  if (!s) return null;
  const m = Math.floor(s / 60);
  return m >= 1 ? `${m} min` : `${s}s`;
};

export default function KindListPage() {
  const { kind: raw } = useParams<{ kind: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const kind = VALID.includes(raw as ContentKind) ? (raw as ContentKind) : null;

  useEffect(() => {
    if (!kind) router.replace("/dashboard");
  }, [kind, router]);

  const items = useStore(() => (kind ? contentByKind(kind) : []), [kind]);
  const users = useStore(() => getUsers());

  if (!user || !kind || !items || !users) return null;
  const meta = KIND_META[kind];
  const Icon = ICONS[kind as keyof typeof ICONS];

  return (
    <div>
      <SectionHeader
        title={meta.label}
        sub={`${meta.mode} · ${meta.tagline} for the DailyMattr app.`}
      >
        <Link
          href={`/content/${kind}/editor`}
          className="btn-primary px-5 py-2.5 text-sm"
        >
          + New {meta.label.replace(/s$/, "")}
        </Link>
      </SectionHeader>

      {items.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-accent">
            <Icon size={22} />
          </span>
          <p className="font-bold">No {meta.label.toLowerCase()} yet</p>
          <p className="max-w-xs text-sm text-muted">
            Create the first one — it starts as a draft and flows through QA
            before publishing.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((c, i) => {
            const author = users.find((u) => u.id === c.createdBy);
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.4 }}
              >
                <Link
                  href={`/content/${kind}/editor?id=${c.id}`}
                  className="card card-hover block overflow-hidden"
                >
                  <div className="relative">
                    {c.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.coverUrl}
                        alt=""
                        className="h-36 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-36 w-full items-center justify-center bg-canvas text-faint">
                        <Icon size={28} />
                      </div>
                    )}
                    <div className="absolute top-3 left-3">
                      <StatusPill status={c.status} />
                    </div>
                    {c.durationSec && (
                      <span className="absolute right-3 bottom-3 rounded-full bg-ink/70 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
                        {fmtDur(c.durationSec)}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="line-clamp-2 text-[14px] leading-snug font-bold">
                      {c.title}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">
                      {c.summary}
                    </p>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
                      <span>{author?.fullName ?? "—"}</span>
                      <span className="flex items-center gap-1">
                        <Clock3 size={11} /> {timeAgo(c.updatedAt)}
                      </span>
                    </div>
                    {c.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => (
                          <Pill key={t} tone="muted">
                            #{t}
                          </Pill>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
