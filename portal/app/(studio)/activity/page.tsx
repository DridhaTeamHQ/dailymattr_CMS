"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, History } from "lucide-react";
import { Avatar, Pill, SectionHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { listAudit, listUsers } from "@/lib/db";
import { timeAgo } from "@/lib/store";
import { useQuery } from "@/lib/useQuery";
import { ActivitySkeleton } from "@/components/PageSkeleton";

const PAGE = 25;

/** Groups entries under Today / Yesterday / a date. */
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ActivityPage() {
  const { user } = useAuth();
  const [shown, setShown] = useState(PAGE);
  const [who, setWho] = useState<string>("all");

  const { data, error } = useQuery(async () => {
    const [audit, users] = await Promise.all([listAudit(500), listUsers()]);
    return { audit, users };
  });

  if (error)
    return (
      <div className="card p-8 text-sm text-rose">
        Couldn&apos;t load activity: {error}
      </div>
    );
  if (!user || !data) return <ActivitySkeleton />;

  const filtered =
    who === "all" ? data.audit : data.audit.filter((a) => a.actorId === who);
  const visible = filtered.slice(0, shown);

  // group consecutive entries by day
  const groups: { label: string; items: typeof visible }[] = [];
  for (const a of visible) {
    const label = dayLabel(a.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(a);
    else groups.push({ label, items: [a] });
  }

  const hueFor = (id: string) =>
    data.users.find((u) => u.id === id)?.avatarHue ?? 220;

  return (
    <div className="max-w-3xl">
      <Link
        href="/dashboard"
        className="btn-ghost mb-5 inline-flex items-center gap-2 px-4 py-2 text-xs"
      >
        <ArrowLeft size={14} /> Back to dashboard
      </Link>

      <SectionHeader
        title="Activity"
        sub="Every approval, edit and publish across the newsroom."
      >
        <select
          className="field !w-auto !py-2 text-[13px]"
          value={who}
          onChange={(e) => {
            setWho(e.target.value);
            setShown(PAGE);
          }}
        >
          <option value="all">Everyone</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </select>
      </SectionHeader>

      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-accent">
            <History size={20} />
          </span>
          <p className="font-bold">No activity yet</p>
          <p className="text-sm text-muted">
            Approvals, edits and publishes will show up here.
          </p>
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.label} className="mb-6">
              <h2 className="mb-2 px-1 text-[11px] font-bold tracking-widest text-faint uppercase">
                {g.label}
              </h2>
              <div className="card divide-y divide-line overflow-hidden">
                {g.items.map((a, i) => (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.2) }}
                    className="flex items-start gap-3 p-4 transition-colors hover:bg-canvas"
                  >
                    <Avatar
                      name={a.actorName}
                      hue={hueFor(a.actorId)}
                      size={34}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-snug">
                        <span className="font-bold">{a.actorName}</span>{" "}
                        <span className="text-muted">{a.action}</span>{" "}
                        <span className="font-semibold">{a.entityTitle}</span>
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Pill tone="muted">{a.entity}</Pill>
                        <span className="text-[11px] text-faint">
                          {timeAgo(a.createdAt)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          ))}

          {shown < filtered.length && (
            <button
              onClick={() => setShown((s) => s + PAGE)}
              className="btn-ghost w-full py-3 text-xs"
            >
              Load {Math.min(PAGE, filtered.length - shown)} more ·{" "}
              {filtered.length - shown} remaining
            </button>
          )}
        </>
      )}
    </div>
  );
}
