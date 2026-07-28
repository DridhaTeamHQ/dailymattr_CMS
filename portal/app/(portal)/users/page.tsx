"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { UserPlus } from "lucide-react";
import { Avatar, Modal, Pill, SectionHeader } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import { inviteUser, listUsers, logAudit, updateUser } from "@/lib/db";
import { useQuery } from "@/lib/useQuery";
import { ROLE_META, type Role } from "@/lib/types";

const ROLES: Role[] = ["super_admin", "chief_editor", "writer", "qa"];

export default function UsersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "writer" as Role });

  useEffect(() => {
    if (user && !can.manageUsers(user.role)) router.replace("/dashboard");
  }, [user, router]);

  const { data: users, error, refetch } = useQuery(() => listUsers());
  if (error)
    return (
      <div className="card p-8 text-sm text-rose">
        Couldn&apos;t load the team: {error}
      </div>
    );
  if (!user || !users || !can.manageUsers(user.role)) return null;

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
      <SectionHeader title="Team" sub="Roles mirror the publishing workflow.">
        <button
          onClick={() => setAdding(true)}
          className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm"
        >
          <UserPlus size={15} /> Invite member
        </button>
      </SectionHeader>

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

      <Modal open={adding} onClose={() => setAdding(false)} title="Invite a member">
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
            disabled={!form.name || !form.email}
            className="btn-accent w-full py-3 text-sm disabled:opacity-40"
          >
            Send invite (demo)
          </button>
        </div>
      </Modal>
    </div>
  );
}
