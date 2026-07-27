"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Rocket, ShieldCheck, XCircle } from "lucide-react";
import { Modal, Pill, SectionHeader, StatusPill } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import { getContent, getUsers, setStatus, timeAgo } from "@/lib/store";
import { useStore } from "@/lib/useStore";
import { KIND_META, type CmsUser, type ContentItem } from "@/lib/types";

function Row({
  c,
  users,
  actions,
}: {
  c: ContentItem;
  users: CmsUser[];
  actions: React.ReactNode;
}) {
  const author = users.find((u) => u.id === c.createdBy);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 60, transition: { duration: 0.25 } }}
      className="card flex flex-wrap items-center gap-4 p-4"
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
        <div className="mb-1 flex items-center gap-2">
          <Pill tone="accent">{KIND_META[c.kind].label}</Pill>
          <StatusPill status={c.status} />
        </div>
        <p className="truncate text-[14px] font-bold">{c.title}</p>
        <p className="mt-0.5 text-[11px] text-faint">
          by {author?.fullName ?? "—"} · updated {timeAgo(c.updatedAt)}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">{actions}</div>
    </motion.div>
  );
}

export default function ReviewPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (user && !can.review(user.role)) router.replace("/dashboard");
  }, [user, router]);

  const data = useStore(
    () => ({
      queue: getContent().filter((c) => c.status === "in_review"),
      approved: getContent().filter((c) => c.status === "approved"),
      users: getUsers(),
    }),
    [tick]
  );

  if (!user || !data || !can.review(user.role)) return null;
  const publisher = can.publish(user.role);

  const act = (id: string, status: "approved" | "published" | "rejected", n?: string) => {
    setStatus(id, status, user, n);
    setTick((t) => t + 1);
  };

  return (
    <div>
      <SectionHeader
        title="Review queue"
        sub="Quality-check submissions, then approve for publishing."
      >
        <Pill tone="amber">{data.queue.length} waiting</Pill>
      </SectionHeader>

      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {data.queue.map((c) => (
            <Row
              key={c.id}
              c={c}
              users={data.users}
              actions={
                <>
                  <button
                    onClick={() => {
                      setRejecting(c.id);
                      setNote("");
                    }}
                    className="btn-ghost flex items-center gap-1.5 px-4 py-2 text-xs !text-rose"
                  >
                    <XCircle size={14} /> Reject
                  </button>
                  <button
                    onClick={() => act(c.id, "approved")}
                    className="btn-primary flex items-center gap-1.5 px-4 py-2 text-xs"
                  >
                    <CheckCircle2 size={14} /> Approve
                  </button>
                </>
              }
            />
          ))}
        </AnimatePresence>
        {data.queue.length === 0 && (
          <div className="card flex flex-col items-center gap-2 p-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mint-tint text-mint">
              <ShieldCheck size={22} />
            </span>
            <p className="font-bold">Queue is clear</p>
            <p className="text-sm text-muted">
              New submissions from writers will land here.
            </p>
          </div>
        )}
      </div>

      {data.approved.length > 0 && (
        <>
          <h3 className="mt-8 mb-3 font-bold">
            Approved — ready to publish{" "}
            <span className="text-sm font-medium text-muted">
              ({publisher ? "you can publish" : "chief editor publishes"})
            </span>
          </h3>
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {data.approved.map((c) => (
                <Row
                  key={c.id}
                  c={c}
                  users={data.users}
                  actions={
                    publisher ? (
                      <button
                        onClick={() => act(c.id, "published")}
                        className="btn-accent flex items-center gap-1.5 px-4 py-2 text-xs"
                      >
                        <Rocket size={14} /> Publish to app
                      </button>
                    ) : (
                      <Pill tone="violet">Awaiting publish</Pill>
                    )
                  }
                />
              ))}
            </AnimatePresence>
          </div>
        </>
      )}

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject with a note"
      >
        <p className="mb-3 text-sm text-muted">
          Tell the writer what to fix — they'll see this on the draft.
        </p>
        <textarea
          className="field min-h-24"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Verify the fare numbers with DGCA data and tighten the last line."
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setRejecting(null)}
            className="btn-ghost px-4 py-2 text-xs"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (rejecting) act(rejecting, "rejected", note || undefined);
              setRejecting(null);
            }}
            className="btn-primary px-4 py-2 text-xs !bg-rose hover:!bg-rose"
          >
            Reject item
          </button>
        </div>
      </Modal>
    </div>
  );
}
