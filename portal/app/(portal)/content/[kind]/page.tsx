"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  AudioLines,
  Check,
  Clapperboard,
  Clock3,
  Eye,
  Image as ImageIcon,
  Rocket,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Pager } from "@/components/Pager";
import { PixCard, PixPreviewModal } from "@/components/PixCard";
import { Modal, Pill, SectionHeader, StatusPill } from "@/components/ui";
import { PAGE_SIZES, clampPage, pageSlice } from "@/lib/paginate";
import { can, useAuth } from "@/lib/auth";
import {
  contentByKind,
  deleteContent,
  getUsers,
  setStatus,
  timeAgo,
} from "@/lib/store";
import { useStore } from "@/lib/useStore";
import {
  KIND_META,
  type ContentItem,
  type ContentKind,
  type ContentStatus,
} from "@/lib/types";

const VALID: ContentKind[] = ["pix", "qix", "trax"];

type PixTab = "all" | "queue" | "feed";

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
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<PixTab>("all");
  const [tick, setTick] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!kind) router.replace("/dashboard");
  }, [kind, router]);

  const items = useStore(() => (kind ? contentByKind(kind) : []), [kind, tick]);
  const users = useStore(() => getUsers());

  if (!user || !kind || !items || !users) return null;
  const meta = KIND_META[kind];
  const Icon = ICONS[kind as keyof typeof ICONS];

  const reviewer = can.review(user.role);
  const publisher = can.publish(user.role);

  const act = (id: string, status: ContentStatus, n?: string) => {
    setStatus(id, status, user, n);
    setTick((t) => t + 1);
  };

  const preview = items.find((c) => c.id === previewId) ?? null;
  const queue = items.filter((c) => c.status === "in_review");
  const feed = items.filter((c) => c.status === "published");
  const visible =
    kind !== "pix" || tab === "all" ? items : tab === "queue" ? queue : feed;

  // Pix only — Qix and Trax stay on a single page for now.
  // Approving or deleting can empty the last page, so clamp before slicing.
  const size = PAGE_SIZES.pixGrid;
  const current = clampPage(page, visible.length, size);
  const paged = pageSlice(visible, current, size);

  const PIX_TABS: [PixTab, string, number][] = [
    ["all", "All Pix", items.length],
    ...(reviewer
      ? ([["queue", "Awaiting QA", queue.length]] as [PixTab, string, number][])
      : []),
    ["feed", "App feed", feed.length],
  ];

  /** QA / chief-editor controls that replace the writer's Edit-View-Delete row. */
  const reviewActions = (c: ContentItem) => (
    <>
      {c.status === "in_review" ? (
        <>
          <button
            onClick={() => act(c.id, "approved")}
            className="btn-primary flex flex-1 items-center justify-center gap-1 px-1.5 py-1.5 text-[11px]"
          >
            <Check size={11} strokeWidth={3} /> Approve
          </button>
          <button
            onClick={() => {
              setRejectId(c.id);
              setNote("");
            }}
            className="btn-ghost flex flex-1 items-center justify-center gap-1 px-1.5 py-1.5 text-[11px] !text-rose hover:!border-rose/40 hover:!bg-rose-tint"
          >
            <X size={11} strokeWidth={3} /> Decline
          </button>
        </>
      ) : c.status === "approved" ? (
        <>
          <span className="flex flex-1 items-center justify-center gap-1 rounded-full bg-mint-tint py-1.5 text-[11px] font-bold text-mint">
            <Check size={11} strokeWidth={3} /> Approved
          </span>
          <button
            onClick={() => act(c.id, "in_review")}
            title="Undo — send back to the queue"
            className="btn-ghost flex h-[26px] w-[26px] shrink-0 items-center justify-center !p-0 hover:!text-rose"
          >
            <X size={11} />
          </button>
          {publisher && (
            <button
              onClick={() => act(c.id, "published")}
              className="btn-accent flex w-full items-center justify-center gap-1 py-1.5 text-[11px]"
            >
              <Rocket size={11} /> Publish to app
            </button>
          )}
        </>
      ) : c.status === "rejected" ? (
        <>
          <span className="flex flex-1 items-center justify-center gap-1 rounded-full bg-rose-tint py-1.5 text-[11px] font-bold text-rose">
            <X size={11} strokeWidth={3} /> Declined
          </span>
          <button
            onClick={() => act(c.id, "in_review")}
            title="Undo — put back in the queue"
            className="btn-ghost flex h-[26px] w-[26px] shrink-0 items-center justify-center !p-0"
          >
            <Undo2 size={11} />
          </button>
        </>
      ) : c.status === "published" ? (
        <>
          <span className="flex flex-1 items-center justify-center gap-1 rounded-full bg-canvas py-1.5 text-[11px] font-bold text-faint">
            Live in app
          </span>
          {/* Pulling a live Pix out of the app feed — QA only. */}
          <button
            onClick={() => setDeleteId(c.id)}
            aria-label={`Remove ${c.title} from the app feed`}
            title="Remove from app feed"
            className="btn-ghost flex h-[26px] w-[26px] shrink-0 items-center justify-center !p-0 text-rose hover:!border-rose/40 hover:!bg-rose-tint hover:text-rose"
          >
            <Trash2 size={11} />
          </button>
        </>
      ) : (
        <span className="flex flex-1 items-center justify-center gap-1 rounded-full bg-canvas py-1.5 text-[11px] font-bold text-faint">
          Not submitted
        </span>
      )}
      <button
        onClick={() => setPreviewId(c.id)}
        title="Preview"
        className="btn-ghost flex h-[26px] w-[26px] shrink-0 items-center justify-center !p-0"
      >
        <Eye size={11} />
      </button>
    </>
  );

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

      {kind === "pix" && items.length > 0 && (
        <div className="mb-5 flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-(--shadow-soft)">
          {PIX_TABS.map(([t, label, count]) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setPage(1);
              }}
              className={`relative rounded-full px-4 py-2 text-[13px] font-bold whitespace-nowrap transition-colors ${
                tab === t ? "text-white" : "text-muted hover:text-ink"
              }`}
            >
              {tab === t && (
                <motion.span
                  layoutId="pix-tab-active"
                  className="absolute inset-0 rounded-full bg-ink"
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                />
              )}
              <span className="relative z-10">
                {label}
                <span className={tab === t ? "text-white/50" : "text-faint"}>
                  {" "}
                  · {count}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

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
      ) : kind === "pix" ? (
        visible.length === 0 ? (
          <div className="card flex flex-col items-center gap-2 p-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mint-tint text-mint">
              <Check size={20} />
            </span>
            <p className="font-bold">
              {tab === "queue" ? "Queue is clear" : "Nothing live yet"}
            </p>
            <p className="max-w-xs text-sm text-muted">
              {tab === "queue"
                ? "Pix submitted by writers land here for review."
                : "Approved Pix appear here once the chief editor publishes them."}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {paged.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.4 }}
                >
                  <PixCard
                    item={c}
                    author={users.find((u) => u.id === c.createdBy)?.fullName}
                    onView={() => setPreviewId(c.id)}
                    actions={reviewer ? reviewActions(c) : undefined}
                  />
                </motion.div>
              ))}
            </div>
            <Pager
              page={current}
              total={visible.length}
              size={size}
              onPage={setPage}
              label="Pix"
            />
          </>
        )
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

      {kind === "pix" && (
        <>
          <PixPreviewModal
            item={preview}
            onClose={() => setPreviewId(null)}
            actions={
              reviewer && preview?.status === "in_review" ? (
                <>
                  <button
                    onClick={() => {
                      setRejectId(preview.id);
                      setNote("");
                      setPreviewId(null);
                    }}
                    className="btn-ghost flex items-center gap-1.5 px-4 py-2.5 text-sm !text-rose"
                  >
                    <X size={14} /> Decline
                  </button>
                  <button
                    onClick={() => {
                      act(preview.id, "approved");
                      setPreviewId(null);
                    }}
                    className="btn-primary flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 text-sm"
                  >
                    <Check size={14} strokeWidth={3} /> Approve
                  </button>
                </>
              ) : reviewer && preview?.status === "approved" && publisher ? (
                <button
                  onClick={() => {
                    act(preview.id, "published");
                    setPreviewId(null);
                  }}
                  className="btn-accent flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 text-sm"
                >
                  <Rocket size={14} /> Publish to app
                </button>
              ) : reviewer ? null : (
                <Link
                  href={`/content/pix/editor?id=${previewId}`}
                  className="btn-primary flex-1 px-4 py-2.5 text-center text-sm"
                >
                  Edit this Pix
                </Link>
              )
            }
          />
          <RejectWithNote
            item={items.find((c) => c.id === rejectId) ?? null}
            note={note}
            onNote={setNote}
            onClose={() => setRejectId(null)}
            onConfirm={(id) => {
              act(id, "rejected", note || undefined);
              setRejectId(null);
            }}
          />
          <ConfirmDelete
            item={items.find((c) => c.id === deleteId) ?? null}
            onClose={() => setDeleteId(null)}
            onConfirm={(id) => {
              deleteContent(id, user);
              setDeleteId(null);
              setPreviewId((p) => (p === id ? null : p));
            }}
          />
        </>
      )}
    </div>
  );
}

function RejectWithNote({
  item,
  note,
  onNote,
  onClose,
  onConfirm,
}: {
  item: ContentItem | null;
  note: string;
  onNote: (v: string) => void;
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  return (
    <Modal open={!!item} onClose={onClose} title="Decline with a note">
      {item && (
        <div>
          <p className="mb-3 text-sm text-muted">
            Tell the writer what to fix on{" "}
            <span className="font-bold text-ink">{item.title}</span>
            {" — they'll see this on the draft."}
          </p>
          <textarea
            className="field min-h-24"
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder="e.g. Point 2 needs a source — confirm the fare cap with the metro press note."
            autoFocus
          />
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} className="btn-ghost px-4 py-2 text-xs">
              Cancel
            </button>
            <button
              onClick={() => onConfirm(item.id)}
              className="btn-primary px-4 py-2 text-xs !bg-rose hover:!bg-rose"
            >
              Decline Pix
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ConfirmDelete({
  item,
  onClose,
  onConfirm,
}: {
  item: ReturnType<typeof contentByKind>[number] | null;
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={
        item?.status === "published"
          ? "Remove from the app feed?"
          : "Delete Pix?"
      }
    >
      {item && (
        <div>
          <p className="text-sm text-muted">
            <span className="font-bold text-ink">{item.title}</span>{" "}
            {item.status === "published"
              ? "is live in the app. Deleting pulls it from the feed for every reader and removes it here too. This can't be undone."
              : "will be removed permanently. This can't be undone."}
          </p>
          <div className="mt-6 flex gap-2">
            <button
              onClick={() => onConfirm(item.id)}
              className="flex-1 rounded-full bg-rose px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 active:scale-[0.97]"
            >
              {item.status === "published"
                ? "Remove from the feed"
                : "Delete permanently"}
            </button>
            <button onClick={onClose} className="btn-ghost px-5 py-2.5 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

