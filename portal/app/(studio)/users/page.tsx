"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { BarChart3, Settings2, UserPlus } from "lucide-react";
import PerformanceCard from "@/components/PerformanceCard";
import TeamChart from "@/components/TeamChart";
import { Avatar, Modal, Pill, SectionHeader } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { supabase } from "@/lib/supabase";
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

/** Kept in step with the same floor in app/api/users/route.ts. */
const MIN_PASSWORD = 10;

type Tab = "performance" | "access";

export default function UsersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("performance");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "writer" as Role,
  });

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
    const reactivating = !u.isActive;
    const ok = await toast.run(
      async () => {
        await updateUser(id, { isActive: reactivating });
        await logAudit(
          user,
          reactivating ? "reactivated" : "deactivated",
          "user",
          u.fullName
        );
      },
      {
        success: reactivating
          ? `${u.fullName} can sign in again`
          : `${u.fullName} can no longer sign in`,
        error: `Couldn't change ${u.fullName}'s access`,
      }
    );
    if (ok) refetch();
  };

  const setRole = async (id: string, role: Role) => {
    const u = users.find((x) => x.id === id);
    if (!u || u.id === user.id) return;
    const ok = await toast.run(
      async () => {
        await updateUser(id, { role });
        await logAudit(
          user,
          `set role ${ROLE_META[role].label}`,
          "user",
          u.fullName
        );
      },
      {
        success: `${u.fullName} is now ${ROLE_META[role].label}`,
        error: `Couldn't change ${u.fullName}'s role`,
      }
    );
    // Refetch either way: on failure the select has already moved, and the
    // reload is what puts it back to the role the database still holds.
    refetch();
    return ok;
  };

  const invite = async () => {
    if (busy) return;

    // Say what is missing rather than sitting there greyed out. Every one of
    // these used to either disable the button silently or return without a
    // word, which is indistinguishable from a button that does not work.
    if (!form.name.trim()) {
      toast.error("Add their full name first.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error("That email address doesn't look right.");
      return;
    }
    if (form.password.length < MIN_PASSWORD) {
      toast.error(
        `The temporary password needs at least ${MIN_PASSWORD} characters — it has ${form.password.length}.`
      );
      return;
    }

    setBusy(true);
    try {
      const name = form.name;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Your session expired — sign in again.");
        return;
      }

      // The server creates the login; a browser cannot, which is why adding
      // someone used to leave them unable to sign in.
      const res = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: form.email,
          fullName: name,
          role: form.role,
          password: form.password,
        }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        // A deployment without the service-role key can still record the
        // profile — better a half-finished member than a dead button — but it
        // has to say plainly that the login is still missing.
        if (payload?.code === "not_configured") {
          const saved = await toast.run(
            async () => {
              await inviteUser({
                email: form.email,
                fullName: name,
                role: form.role,
                languages: ["en"],
                states: [],
                isActive: true,
                avatarHue: Math.floor(Math.random() * 360),
              });
              await logAudit(user, "invited", "user", name);
            },
            {
              success: `${name}'s profile saved — but they still cannot sign in`,
              // The usual cause on a retry: a profile for this address is
              // already there from an earlier attempt.
              error: `Couldn't add ${name} — is that email already on the team?`,
            }
          );
          if (saved)
            // An error, not an info: the member cannot sign in, which is the
            // thing the administrator was trying to achieve. Errors stay until
            // dismissed, so this cannot scroll past unnoticed.
            toast.error({
              message: `${name} still has no login`,
              detail:
                "SUPABASE_SERVICE_ROLE_KEY is not set on this server. Add it to portal/.env.local and restart the dev server, or create their login in Supabase → Authentication → Users.",
            });
          if (!saved) return;
        } else {
          toast.error({
            message: `Couldn't add ${name}`,
            detail: payload?.error ?? `The server said ${res.status}.`,
          });
          return;
        }
      } else {
        await logAudit(user, "invited", "user", name);
        toast.success({
          message: `${name} can sign in now`,
          detail: `${form.email} · ${ROLE_META[form.role].label}`,
        });
      }

      setAdding(false);
      setForm({ name: "", email: "", password: "", role: "writer" });
      refetch();
    } catch (e) {
      toast.error({
        message: `Couldn't add ${form.name}`,
        detail: e instanceof Error ? e.message : String(e),
      });
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
          <div>
            <div className="label mb-2">Temporary password</div>
            <input
              className="field"
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={`At least ${MIN_PASSWORD} characters`}
              autoComplete="off"
              spellCheck={false}
            />
            {/* Deliberately not a masked field. It is being read out or pasted
                into a message, not typed from memory, and hiding it only
                invites typos in a password someone else has to use. */}
            <p className="mt-1.5 text-[11px] text-faint">
              {form.password.length === 0
                ? `Required — at least ${MIN_PASSWORD} characters.`
                : form.password.length < MIN_PASSWORD
                  ? `${MIN_PASSWORD - form.password.length} more character${
                      MIN_PASSWORD - form.password.length === 1 ? "" : "s"
                    } needed.`
                  : "Share this with them and ask them to change it after signing in."}
            </p>
          </div>

          {/* Only disabled while the request is in flight. Disabling it for
              incomplete fields is what made this look broken: nothing said
              which field was the problem, so the button just sat there. It
              stays clickable and `invite` names what is missing. */}
          <button
            onClick={invite}
            disabled={busy}
            className="btn-accent w-full py-3 text-sm disabled:opacity-40"
          >
            {busy ? "Creating account…" : "Add to team"}
          </button>
          <p className="text-[11px] leading-relaxed text-faint">
            This creates their sign-in account and their Studio profile
            together, so they can sign in straight away with the email and
            password above.
          </p>
        </div>
      </Modal>
    </div>
  );
}
