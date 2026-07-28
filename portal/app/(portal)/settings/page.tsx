"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2 } from "lucide-react";
import { Pill, SectionHeader } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import {
  addCategory,
  listCategories,
  logAudit,
  removeCategory,
  setCategoryActive,
} from "@/lib/db";
import { slugify } from "@/lib/store";
import { useQuery } from "@/lib/useQuery";

export default function SettingsPage() {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const { data: categories, error, refetch } = useQuery(() => listCategories());

  if (error)
    return (
      <div className="card p-8 text-sm text-rose">
        Couldn&apos;t load categories: {error}
      </div>
    );
  if (!user || !categories) return null;
  const manager = can.manageCategories(user.role);

  const add = async () => {
    if (!name.trim() || !manager) return;
    await addCategory({
      slug: slugify(name),
      name: name.trim(),
      kind: null,
      sortOrder: categories.length + 1,
      isActive: true,
    });
    await logAudit(user, "added category", "category", name.trim());
    setName("");
    refetch();
  };

  const toggle = async (slug: string) => {
    if (!manager) return;
    const c = categories.find((x) => x.slug === slug);
    if (!c) return;
    await setCategoryActive(slug, !c.isActive);
    refetch();
  };

  const remove = async (slug: string) => {
    if (!manager) return;
    await removeCategory(slug);
    refetch();
  };

  return (
    <div className="max-w-2xl">
      <SectionHeader
        title="Settings"
        sub="Categories power every editor's dropdown and the app's filter chips."
      />

      <div className="card p-6">
        <h3 className="mb-4 font-bold">Categories</h3>
        {manager && (
          <div className="mb-5 flex gap-2">
            <input
              className="field flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="New category name…"
            />
            <button
              onClick={add}
              disabled={!name.trim()}
              className="btn-primary flex items-center gap-1.5 px-4 py-2 text-xs disabled:opacity-40"
            >
              <Plus size={14} /> Add
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {categories.map((c, i) => (
            <motion.span
              key={c.slug}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.03 }}
              className={`group flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition-all ${
                c.isActive
                  ? "border-line bg-white shadow-(--shadow-soft)"
                  : "border-dashed border-line text-faint"
              }`}
            >
              <button
                onClick={() => toggle(c.slug)}
                disabled={!manager}
                title={c.isActive ? "Disable" : "Enable"}
              >
                {c.name}
              </button>
              {manager && (
                <button
                  onClick={() => remove(c.slug)}
                  className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </motion.span>
          ))}
        </div>
        {!manager && (
          <p className="mt-4 text-xs text-faint">
            Only chief editors and super admins can edit categories.
          </p>
        )}
      </div>

      <div className="card mt-6 p-6">
        <h3 className="mb-1 font-bold">Where this data lives</h3>
        <p className="text-sm leading-relaxed text-muted">
          The Studio reads and writes the <b>DailyMattr CMS</b> Supabase
          project. Role permissions are enforced by row-level security and a
          publish trigger, not by the buttons this page hides — so a writer
          cannot publish even by calling the API directly. NewsStudio articles
          are read from the pipeline database, which the CMS never writes to.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["Supabase Auth", "RLS", "Publish trigger", "NewsStudio (read-only)"].map(
            (t) => (
              <Pill key={t} tone="accent">
                {t}
              </Pill>
            )
          )}
        </div>
      </div>
    </div>
  );
}
