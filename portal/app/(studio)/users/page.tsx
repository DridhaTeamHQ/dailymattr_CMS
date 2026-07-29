"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { BarChart3, Settings2, UserPlus } from "lucide-react";
import PerformanceCard from "@/components/PerformanceCard";
import TeamChart from "@/components/TeamChart";
import { Avatar, Modal, Pill, SectionHeader } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import {
  inviteUser,
  listPerformance,
  listUsers,
  logAudit,
  updateUser,
} from "@/lib/db";
import { useQuery } from "@/lib/useQuery";
import { UsersSkeleton } from "@/components/PageSkeleton";
import { ROLE_META, type Role } from "@/lib/types";

const ROLES: Role[] = ["super_admin", "chief_editor", "writer", "qa"];

type Tab = "performance" | "access";

export default function UsersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("performance");
  const [form, setForm] = useState({ name: "", email: "", role: "writer" as Role });

  useEffect(() => {
    if (user && !can.manageUsers(user.role)) router.replace("/dashboard");
  }, [user, router]);

  const { data, error, refetch } = useQuery(async () => {
    const [users, performance] = await Promise.all([
      listUsers(),
      listPerformance(),
    ]);
    return { users, performance };
  });
  if (error)
    return (
      <div className="card p-8 text-sm text-rose">
        Couldn&apos;t load the team: {error}
      </div>
    );
  if (!user || !data || !can.manageUsers(user.role)) return <UsersSkeleton />;
  const { users, performance } = data;

  // Newsroom totals, so the page opens with the shape of the whole team.
  const totals = performance.reduce(
    (a, p) => ({
      created: a.created + p.createdTotal,
      live: a.live + p.live,
      waiting: a.waiting + p.awaitingReview,
      reviewed: a.reviewed + p.reviewed,
    }),
    { created: 0, live: 0, waiting: 0, reviewed: 0 }
  );

  // Shared scales, so a bar of a given height means the same number on every
  // card. Computed per card, the tallest bar would always be full height and
  // the grid would say nothing about who did more.
  const formatMax = Math.max(
    1,
    ...performance.flatMap((p) => [
      p.createdArticles,
      p.createdPix,
      p.createdQix,
      p.createdTrax,
    ])
  );
  const reviewMax = Math.max(
    1,
    ...performance.flatMap((p) => [
      p.reviewed,
      p.publishedByThem,
      p.articlesApproved,
    ])
  );

  const toggleActive = async (id: string) => {
    const u = users.find((x) => x.id === id);
    if (!u || u.id === user.id) return;
    await updateUser(id, { isActive: !u.isActive });
    await logAudit(
      user,
      !u.isActive ? "reactivated" : "deactivated",
      "user",
      u.fullName
    );
    refetch();
  };

  const setRole = async (id: string, role: Role) => {
    const u = users.find((x) => x.id === id);
    if (!u || u.id === user.id) return;
    await updateUser(id, { role });
    await logAudit(user, `set role ${ROLE_META[role].label}`, "user", u.fullName);
    refetch();
  };

  const invite = async () => {
    if (!form.name || !form.email || busy) return;
    setBusy(true);
    try {
      await inviteUser({
        email: form.email,
        fullName: form.name,
        role: form.role,
        languages: ["en"],
        states: [],
        isActive: true,
        avatarHue: Math.floor(Math.random() * 360),
      });
      await logAudit(user, "invited", "user", form.name);
      setAdding(false);
      setForm({ name: "", email: "", role: "writer" });
      refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionHeader
        title="Team"
        sub="Who is making what, and how much of it reaches readers."
      >
        <button
          onClick={() => setAdding(true)}
          className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm"
        >
          <UserPlus size={15} /> Add member
        </button>
      </SectionHeader>

      {/* newsroom totals */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Created", value: totals.created, tone: "text-ink" },
          { label: "Live in app", value: totals.live, tone: "text-mint" },
          { label: "Awaiting QA", value: totals.waiting, tone: "text-amber" },
          { label: "Reviewed", value: totals.reviewed, tone: "text-accent" },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="card px-5 py-4"
          >
            <div className={`text-2xl font-extrabold tabular-nums ${s.tone}`}>
              {s.value}
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-muted">
              {s.label}
            </div>
          </motion.div>
        ))}
      </div>

      {/* tabs */}
      <div className="mb-5 flex w-fit items-center gap-1 rounded-full bg-card p-1 shadow-(--shadow-soft)">
        {(
          [
            ["performance", "Performance", BarChart3],
            ["access", "Roles & access", Settings2],
          ] as [Tab, string, typeof BarChart3][]
        ).map(([t, label, Icon]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-bold transition-colors ${
              tab === t ? "text-white" : "text-muted hover:text-ink"
            }`}
          >
            {tab === t && (
              <motion.span
                layoutId="team-tab"
                className="absolute inset-0 rounded-full bg-shell"
                transition={{ type: "spring", stiffness: 400, damping: 34 }}
              />
            )}
            <Icon size={13} className="relative z-10" />
            <span className="relative z-10">{label}</span>
          </button>
        ))}
      </div>

      {tab === "performance" ? (
        <>
        {/* Comparison first, then the individual cards. The cards say what a
            person did; only a shared axis says who did more. */}
        <TeamChart performance={performance} />
        {/* items-stretch (the grid default) plus h-full on the card means every
            card in a row matches the tallest — the sections inside already
            render at fixed heights, so in practice they all match. */}
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {performance.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.05, 0.3) }}
              className="h-full"
            >
              <PerformanceCard
                p={p}
                formatMax={formatMax}
                reviewMax={reviewMax}
              />
            </motion.div>
          ))}
        </div>
        </>
      ) : (
      <div className="grid gap-4 md:grid-cols-2">
        {users.map((u, i) => (
          <motion.div
            key={u.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`card p-5 ${u.isActive ? "" : "opacity-55"}`}
          >
            <div className="flex items-center gap-4">
              <Avatar name={u.fullName} hue={u.avatarHue} size={46} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-bold">{u.fullName}</p>
                  {u.id === user.id && <Pill tone="accent">you</Pill>}
                </div>
                <p className="truncate text-xs text-muted">{u.email}</p>
              </div>
              <Pill tone={u.isActive ? "mint" : "muted"}>
                {u.isActive ? "Active" : "Disabled"}
              </Pill>
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
              <select
                className="field !w-auto flex-1 !py-2 text-[13px]"
                value={u.role}
                disabled={u.id === user.id}
                onChange={(e) => setRole(u.id, e.target.value as Role)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_META[r].label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => toggleActive(u.id)}
                disabled={u.id === user.id}
                className="btn-ghost px-4 py-2 text-xs disabled:opacity-40"
              >
                {u.isActive ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          </motion.div>
        ))}
      </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a member">
        <div className="space-y-4">
          <div>
            <div className="label mb-2">Full name</div>
            <input
              className="field"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Priya Sharma"
              autoFocus
            />
          </div>
          <div>
            <div className="label mb-2">Email</div>
            <input
              className="field"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="priya@dailymattr.com"
            />
          </div>
          <div>
            <div className="label mb-2">Role</div>
            <select
              className="field"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_META[r].label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={invite}
            disabled={!form.name || !form.email || busy}
            className="btn-accent w-full py-3 text-sm disabled:opacity-40"
          >
            {busy ? "Adding…" : "Add to team"}
          </button>
          {/* Honest about the gap: this writes the Studio profile, but the
              sign-in account is created separately in Supabase Auth — a browser
              cannot create one, that needs the admin API. Spelled out as steps
              because "created separately" read as a footnote, and people added
              here were left with a profile and no way in. */}
          <div className="space-y-1.5 rounded-xl bg-canvas p-3 text-[11px] leading-relaxed text-muted">
            <p className="font-bold text-ink">This does not create their login</p>
            <p>
              It saves their Studio profile and role. To let them in, open
              Supabase → Authentication → Users → <b>Add user</b>, and use the
              same email address.
            </p>
            <p className="text-faint">
              Their role here is kept — signing in adopts this profile rather
              than replacing it.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
