"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Eye, Rocket, ShieldCheck, XCircle } from "lucide-react";
import { Pager } from "@/components/Pager";
import { PixFrame } from "@/components/PixCard";
import ReviewEditModal from "@/components/ReviewEditModal";
import { Modal, Pill, SectionHeader, StatusPill } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import { PAGE_SIZES, clampPage, pageSlice } from "@/lib/paginate";
import { usePageParam } from "@/lib/usePageParam";
import { filledPixPoints } from "@/lib/pix";
import { stripHighlightBrackets } from "@/lib/pixComposer";
import { listContent, listUsers, logAudit, setContentStatus, updateContent } from "@/lib/db";
import { timeAgo } from "@/lib/store";
import { useQuery } from "@/lib/useQuery";
import { ReviewSkeleton } from "@/components/PageSkeleton";
import { KIND_META, type CmsUser, type ContentItem } from "@/lib/types";

function Row({
  c,
  users,
  actions,
  onPreview,
}: {
  c: ContentItem;
  users: CmsUser[];
  actions: React.ReactNode;
  onPreview?: () => void;
}) {
  const author = users.find((u) => u.id === c.createdBy);
  const isPix = c.kind === "pix";
  const points = isPix ? filledPixPoints(c) : [];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 60, transition: { duration: 0.25 } }}
      className="card flex flex-wrap items-center gap-4 p-4"
    >
      {isPix ? (
        <div className="w-[120px] shrink-0">
          <PixFrame item={c} onClick={onPreview} />
        </div>
      ) : c.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={c.coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
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
        <p className={`text-[14px] font-bold ${isPix ? "" : "truncate"}`}>
          {isPix ? stripHighlightBrackets(c.title) : c.title}
        </p>
        {isPix && points.length > 0 && (
          <ul className="mt-2 space-y-1">
            {points.map((p, i) => (
              <li
                key={i}
                className="flex gap-1.5 text-[12px] leading-snug text-muted"
              >
                <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-[11px] text-faint">
          by {author?.fullName ?? "—"} · updated {timeAgo(c.updatedAt)}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {onPreview && (
          <button
            onClick={onPreview}
            className="btn-ghost flex items-center gap-1.5 px-4 py-2 text-xs"
          >
            <Eye size={14} /> Open
          </button>
        )}
        {actions}
      </div>
    </motion.div>
  );
}

/** The two pagers read the query string — see the note on ArticlesPage. */
export default function ReviewPage() {
  return (
    <Suspense fallback={<ReviewSkeleton />}>
      <ReviewQueue />
    </Suspense>
  );
}

function ReviewQueue() {
  const { user } = useAuth();
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // The queue and the approved shelf page independently, so they need a
  // parameter each rather than a shared ?page.
  const [queuePage, setQueuePage] = usePageParam("queue");
  const [approvedPage, setApprovedPage] = usePageParam("approved");

  useEffect(() => {
    if (user && !can.review(user.role)) router.replace("/dashboard");
  }, [user, router]);

  const { data, error, refetch } = useQuery(async () => {
    const [content, users] = await Promise.all([listContent(), listUsers()]);
    return {
      queue: content.filter((c) => c.status === "in_review"),
      approved: content.filter((c) => c.status === "approved"),
      users,
    };
  }, [tick]);

  if (error)
    return (
      <div className="card p-8 text-sm text-rose">
        Couldn&apos;t load the review queue: {error}
      </div>
    );
  if (!user || !data || !can.review(user.role)) return <ReviewSkeleton />;
  const publisher = can.publish(user.role);
  const preview =
    [...data.queue, ...data.approved].find((c) => c.id === previewId) ?? null;

  // Both lists shrink as items move through, so clamp before slicing.
  const size = PAGE_SIZES.reviewRows;
  const qPage = clampPage(queuePage, data.queue.length, size);
  const aPage = clampPage(approvedPage, data.approved.length, size);
  const queueRows = pageSlice(data.queue, qPage, size);
  const approvedRows = pageSlice(data.approved, aPage, size);

  const act = async (
    id: string,
    status: "approved" | "published" | "rejected",
    n?: string
  ) => {
    try {
      await setContentStatus(id, status, user, n);
    } catch (e) {
      // The database has the final say on publishing — surface its refusal.
      alert(e instanceof Error ? e.message : String(e));
    }
    refetch();
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
          {queueRows.map((c) => (
            <Row
              key={c.id}
              c={c}
              users={data.users}
              onPreview={() => setPreviewId(c.id)}
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

      <Pager
        page={qPage}
        total={data.queue.length}
        size={size}
        onPage={setQueuePage}
        label="waiting"
      />

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
              {approvedRows.map((c) => (
                <Row
                  key={c.id}
                  c={c}
                  users={data.users}
                  onPreview={() => setPreviewId(c.id)}
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
          <Pager
            page={aPage}
            total={data.approved.length}
            size={size}
            onPage={setApprovedPage}
            label="approved"
          />
        </>
      )}

      <ReviewEditModal
        item={preview}
        canEdit={can.editInReview(user.role)}
        onClose={() => setPreviewId(null)}
        onSave={async (id, patch) => {
          const saved = await updateContent(id, patch);
          await logAudit(user, "edited in review", saved.kind, saved.title);
          refetch();
        }}
        actions={
          preview?.status === "in_review" ? (
            <>
              <button
                onClick={() => {
                  setRejecting(preview.id);
                  setNote("");
                  setPreviewId(null);
                }}
                className="btn-ghost flex items-center gap-1.5 px-4 py-2.5 text-sm !text-rose"
              >
                <XCircle size={14} /> Reject
              </button>
              <button
                onClick={() => {
                  act(preview.id, "approved");
                  setPreviewId(null);
                }}
                className="btn-primary flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 text-sm"
              >
                <CheckCircle2 size={14} /> Approve
              </button>
            </>
          ) : preview?.status === "approved" && publisher ? (
            <button
              onClick={() => {
                act(preview.id, "published");
                setPreviewId(null);
              }}
              className="btn-accent flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 text-sm"
            >
              <Rocket size={14} /> Publish to app
            </button>
          ) : null
        }
      />

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject with a note"
      >
        <p className="mb-3 text-sm text-muted">
          Tell the writer what to fix — they&apos;ll see this on the draft.
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
